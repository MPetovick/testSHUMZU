document.addEventListener('DOMContentLoaded', () => {
    const scanner = new Instascan.Scanner({ video: document.getElementById('preview'), mirror: false });
    const startBtn = document.getElementById('startBtn');
    const status = document.getElementById('status');
    let isScanning = false;
    let collectedData = new Map();
    let metadata = null;

    // Añadir polyfills necesarios
    async function loadZstd() {
        window.zstd = await import('https://cdn.jsdelivr.net/npm/zstd-codec@0.1.2/zstd-codec.mjs');
    }
    loadZstd();

    // Inicializar Argon2
    const argon2 = await import('https://cdn.jsdelivr.net/npm/argon2-browser@1.18.0/lib/argon2.js');

    startBtn.addEventListener('click', async () => {
        if (!isScanning) {
            const cameras = await Instascan.Camera.getCameras();
            if (cameras.length > 0) {
                await scanner.start(cameras[0]);
                isScanning = true;
                startBtn.textContent = 'Detener Escaneo';
                status.textContent = 'Escaneando... 0% completado';
            } else {
                alert('No se encontraron cámaras!');
            }
        } else {
            scanner.stop();
            isScanning = false;
            startBtn.textContent = 'Iniciar Escaneo';
            status.textContent = 'Detenido';
        }
    });

    scanner.addListener('scan', async (content) => {
        try {
            const data = JSON.parse(content);
            if (!data.index && data.index !== 0) throw new Error('QR inválido');

            // Manejar metadatos (primer bloque)
            if (data.index === 0) {
                metadata = JSON.parse(new TextDecoder().decode(base64ToBytes(data.data)));
                status.textContent = `Escaneando ${metadata.file_name}...`;
                return;
            }

            // Almacenar bloque
            if (!collectedData.has(data.index)) {
                collectedData.set(data.index, data.data);
                updateProgress();
                
                if (collectedData.size === metadata?.total_blocks) {
                    await processCompleteData();
                }
            }
        } catch (err) {
            console.error('Error procesando QR:', err);
        }
    });

    function updateProgress() {
        const progress = metadata ? 
            Math.round((collectedData.size / metadata.total_blocks) * 100) : 0;
        status.textContent = `Escaneando... ${progress}% completado`;
    }

    async function processCompleteData() {
        try {
            // 1. Solicitar contraseña si es necesario
            const password = metadata.encrypted ? prompt('Ingrese la contraseña:') : null;

            // 2. Ensamblar y procesar bloques
            const blocks = Array.from(collectedData.entries())
                .sort((a, b) => a[0] - b[0])
                .map(entry => base64ToBytes(entry[1]));

            let decodedData = new Uint8Array();
            for (const [index, block] of blocks.entries()) {
                let decryptedBlock = metadata.encrypted ? 
                    await decryptBlock(block, password) : block;
                
                decodedData = concatenateUint8Arrays(
                    decodedData,
                    await decompressBlock(decryptedBlock)
                );
            }

            // 3. Verificar integridad
            const hash = await sha3_256(decodedData);
            if (hash !== metadata.hash) throw new Error('Fallo en verificación de hash');

            // 4. Descargar archivo
            const blob = new Blob([decodedData], { type: 'application/octet-stream' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = metadata.file_name;
            link.click();

            status.textContent = `Archivo ${metadata.file_name} descargado!`;
            resetScanner();

        } catch (err) {
            alert(`Error: ${err.message}`);
            resetScanner();
        }
    }

    async function decryptBlock(data, password) {
        // Implementación compatible con Python
        const salt = data.slice(0, 16);
        const nonce = data.slice(16, 28);
        const tag = data.slice(28, 44);
        const ciphertext = data.slice(44);

        const key = await argon2.hash({
            pass: password,
            salt: salt,
            time: 2,
            mem: 102400,
            hashLen: 32,
            parallelism: 8,
            type: argon2.ArgonType.Argon2id
        });

        const cryptoKey = await crypto.subtle.importKey(
            'raw', key.hash, 'AES-GCM', false, ['decrypt']
        );

        try {
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: nonce, tagLength: 128 },
                cryptoKey,
                concatenateUint8Arrays(ciphertext, tag)
            );
            return new Uint8Array(decrypted);
        } catch {
            throw new Error('Contraseña incorrecta o datos corruptos');
        }
    }

    async function decompressBlock(data) {
        // Descompresión Zstandard + Brotli
        const zstdDecoder = new zstd.ZstdCodec.ZstdStreaming();
        await zstdDecoder.init();
        const zstdDecompressed = zstdDecoder.decompress(data);

        const brotliDecompressed = await new Response(
            new Blob([zstdDecompressed]).stream().pipeThrough(new DecompressionStream('br'))
        ).arrayBuffer();

        return new Uint8Array(brotliDecompressed);
    }

    // Utilidades
    function base64ToBytes(base64) {
        return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }

    async function sha3_256(data) {
        const hashBuffer = await crypto.subtle.digest('SHA3-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function concatenateUint8Arrays(...arrays) {
        let totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
        let result = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }

    function resetScanner() {
        scanner.stop();
        isScanning = false;
        startBtn.textContent = 'Iniciar Escaneo';
        collectedData.clear();
        metadata = null;
    }
});