// Variables globales para almacenar los bloques y metadatos
let blocks = {}; // Bloques de datos
let metadata = null; // Metadatos del archivo

// Constantes basadas en el código Python
const SALT_SIZE = 16;
const NONCE_SIZE = 12;

// Función para derivar la clave con PBKDF2 (alternativa a Argon2)
function deriveKey(password, salt) {
    const keyMaterial = CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(salt), {
        keySize: 256 / 32, // 32 bytes = 256 bits
        iterations: 1000
    });
    return keyMaterial.toString(CryptoJS.enc.Hex);
}

// Función de desencriptación AES-GCM
function decrypt(encryptedData, password) {
    const blob = CryptoJS.enc.Base64.parse(encryptedData);
    const salt = blob.toString(CryptoJS.enc.Hex, 0, SALT_SIZE);
    const nonce = blob.toString(CryptoJS.enc.Hex, SALT_SIZE, SALT_SIZE + NONCE_SIZE);
    const tag = blob.toString(CryptoJS.enc.Hex, SALT_SIZE + NONCE_SIZE, SALT_SIZE + NONCE_SIZE + 16);
    const ciphertext = blob.toString(CryptoJS.enc.Hex, SALT_SIZE + NONCE_SIZE + 16);

    const key = deriveKey(password, salt);
    const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: CryptoJS.enc.Hex.parse(ciphertext), iv: CryptoJS.enc.Hex.parse(nonce) },
        CryptoJS.enc.Hex.parse(key),
        { mode: CryptoJS.mode.GCM, padding: CryptoJS.pad.NoPadding, tag: CryptoJS.enc.Hex.parse(tag) }
    );
    return new Uint8Array(decrypted.toString(CryptoJS.enc.Hex).match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

// Función de descompresión (Zstandard y luego Brotli)
function decompress(data) {
    const zstd = new ZstdDec();
    zstd.init();
    const zstdDecompressed = zstd.decompress(data);
    const brotliDecompressed = BrotliDecode(zstdDecompressed);
    return brotliDecompressed;
}

// Función para guardar el archivo reconstruido
function saveFile(data, filename) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SHUMZU/${filename}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Función para mostrar el modal de contraseña
function showPasswordModal() {
    return new Promise((resolve) => {
        // Asumimos que tienes un modal con id="passwordModal" y un input con id="passwordInput"
        const passwordModal = document.getElementById('passwordModal');
        const passwordInput = document.getElementById('passwordInput');
        const submitPassword = document.getElementById('submitPassword');

        passwordModal.style.display = 'block';
        passwordInput.value = ''; // Limpiar el input

        submitPassword.addEventListener('click', () => {
            const password = passwordInput.value.trim();
            passwordModal.style.display = 'none';
            resolve(password);
        }, { once: true });

        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const password = passwordInput.value.trim();
                passwordModal.style.display = 'none';
                resolve(password);
            }
        }, { once: true });
    });
}

// Función principal para manejar el QR de SHUMZU
async function handleSHUMZUQR(qrData) {
    // Verificar formato del QR
    if (!qrData || typeof qrData !== 'object' || !('index' in qrData) || !('data' in qrData)) {
        alert('QR incompatible: No es un QR de SHUMZU');
        return;
    }

    const password = await showPasswordModal();
    let decryptedData;

    try {
        // Desencriptar si hay contraseña, o simplemente decodificar Base64 si no la hay
        if (password) {
            decryptedData = decrypt(qrData.data, password);
        } else {
            decryptedData = new Uint8Array(
                CryptoJS.enc.Base64.parse(qrData.data)
                    .toString(CryptoJS.enc.Hex)
                    .match(/.{1,2}/g)
                    .map(byte => parseInt(byte, 16))
            );
        }

        // Descomprimir los datos
        const decompressedData = decompress(decryptedData);

        // Procesar según el índice
        if (qrData.index === 0) {
            // Bloque de metadatos
            metadata = JSON.parse(new TextDecoder().decode(decompressedData));
            alert(`Metadatos recibidos: ${metadata.file_name}`);
        } else {
            // Bloque de datos
            blocks[qrData.index] = decompressedData;
            alert(`Bloque ${qrData.index} recibido`);
        }

        // Verificar si tenemos todos los bloques para reconstruir
        if (metadata && Object.keys(blocks).length === metadata.total_blocks) {
            let reconstructedData = new Uint8Array();
            for (let i = 1; i <= metadata.total_blocks; i++) {
                if (!blocks[i]) {
                    alert(`Falta el bloque ${i}`);
                    return;
                }
                reconstructedData = new Uint8Array([...reconstructedData, ...blocks[i]]);
            }

            // Verificar el hash
            const computedHash = sha3_256(reconstructedData).hex();
            if (metadata.hash === computedHash) {
                saveFile(reconstructedData, metadata.file_name);
                alert(`Archivo reconstruido y guardado como SHUMZU/${metadata.file_name}`);
                // Reiniciar las variables
                blocks = {};
                metadata = null;
            } else {
                alert('Error: El hash no coincide, el archivo puede estar corrupto.');
            }
        }
    } catch (e) {
        console.error('Error al procesar el QR:', e);
        alert('Error al desencriptar o reconstruir el archivo. Verifica la contraseña o el formato del QR.');
    }
}

// Ejemplo de integración con el escaneo de QR (ajusta según tu implementación)
function onQRCodeScanned(data) {
    let qrData;
    try {
        qrData = JSON.parse(data);
        handleSHUMZUQR(qrData);
    } catch (e) {
        alert('QR no válido: No contiene un JSON');
    }
}
