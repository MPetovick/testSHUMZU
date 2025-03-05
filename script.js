const video = document.getElementById('video');
const cameraContainer = document.getElementById('cameraContainer');
const passwordModal = document.getElementById('passwordModal');
const passwordInput = document.getElementById('passwordInput');
const submitPassword = document.getElementById('submitPassword');
let stream = null;
let scanning = false;

cameraContainer.classList.remove('active');

const toggleCamera = async () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        video.srcObject = null;
        scanning = false;
        cameraContainer.classList.remove('active');
    } else {
        try {
            cameraContainer.classList.add('active');
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: Math.min(window.innerWidth, 1280) },
                    height: { ideal: Math.min(window.innerHeight, 720) }
                }
            });
            video.srcObject = stream;
            video.play();
            startQRScan();
        } catch (err) {
            console.error('Error al activar la cámara:', err);
            cameraContainer.classList.remove('active');
        }
    }
};

const startQRScan = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    scanning = true;

    const scanFrame = () => {
        if (!scanning) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);
        if (code) {
            try {
                const qrData = JSON.parse(code.data);
                if (qrData.index !== undefined && qrData.data) {
                    console.log('QR SHUMZU detectado:', qrData);
                    handleSHUMZUQR(qrData);
                    scanning = false;
                } else {
                    alert('QR incompatible');
                }
            } catch (e) {
                alert('QR incompatible');
            }
        } else {
            requestAnimationFrame(scanFrame);
        }
    };
    scanFrame();
};

const showPasswordModal = () => {
    return new Promise((resolve) => {
        passwordModal.style.display = 'block';
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
};

const deriveKey = (password, salt) => {
    const keyMaterial = CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(salt), {
        keySize: 256 / 32,
        iterations: 1000
    });
    return keyMaterial.toString(CryptoJS.enc.Hex);
};

const decrypt = (encryptedData, password) => {
    const blob = CryptoJS.enc.Base64.parse(encryptedData);
    const salt = blob.toString(CryptoJS.enc.Hex, 0, 16);
    const nonce = blob.toString(CryptoJS.enc.Hex, 16, 28);
    const tag = blob.toString(CryptoJS.enc.Hex, 28, 44);
    const ciphertext = blob.toString(CryptoJS.enc.Hex, 44);
    const key = deriveKey(password || '', salt);
    const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: CryptoJS.enc.Hex.parse(ciphertext), iv: CryptoJS.enc.Hex.parse(nonce) },
        CryptoJS.enc.Hex.parse(key),
        { mode: CryptoJS.mode.GCM, padding: CryptoJS.pad.NoPadding, tag: CryptoJS.enc.Hex.parse(tag) }
    );
    return new Uint8Array(decrypted.toString(CryptoJS.enc.Hex).match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
};

const decompress = (data) => {
    const brotliDecompressed = BrotliDecode(new Uint8Array(data));
    const zstd = new ZstdDec();
    zstd.init();
    return zstd.decompress(brotliDecompressed);
};

const saveFile = (data, filename) => {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SHUMZU/${filename || 'reconstructed_file'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const handleSHUMZUQR = async (qrData) => {
    const password = await showPasswordModal();
    try {
        let decryptedData = password ? decrypt(qrData.data, password) : new Uint8Array(CryptoJS.enc.Base64.parse(qrData.data).toString(CryptoJS.enc.Hex).match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const decompressedData = decompress(decryptedData);
        if (qrData.index === 0) {
            const metadata = JSON.parse(new TextDecoder().decode(decompressedData));
            saveFile(decompressedData, metadata.file_name);
            alert(`Archivo reconstruido y guardado como SHUMZU/${metadata.file_name}`);
        } else {
            saveFile(decompressedData, `block_${qrData.index}`);
            alert(`Bloque ${qrData.index} reconstruido y guardado en SHUMZU/`);
        }
    } catch (e) {
        console.error('Error al procesar el QR:', e);
        alert('Error al desencriptar o reconstruir el archivo. Verifica la contraseña o el formato del QR.');
    }
};

cameraContainer.addEventListener('click', toggleCamera);

window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(track => track.stop());
});
