class QRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('overlayCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.cameraContainer = document.getElementById('cameraContainer');
        this.inactiveOverlay = document.getElementById('inactiveOverlay');
        this.progressText = document.getElementById('progressText');
        this.progressBar = document.getElementById('progressBar');
        this.stream = null;
        this.scanning = false;
        this.qrDataMap = new Map();
        this.password = null;
        this.totalBlocks = null;
        this.decoder = new ZXing.BrowserMultiFormatReader();
        this.detectedQRs = []; // Almacenar posiciones de QR detectados
        this.init();
    }

    init() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Este navegador no soporta el acceso a la cámara.');
            return;
        }

        this.cameraContainer.addEventListener('click', () => this.toggleCamera());
        document.getElementById('reconstructButton').addEventListener('click', () => this.reconstructFile());
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    async toggleCamera() {
        if (this.stream) {
            this.stopCamera();
        } else {
            await this.startCamera();
        }
    }

    async startCamera() {
        try {
            this.cameraContainer.classList.add('active');
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            this.video.srcObject = this.stream;
            
            await new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.video.play().then(() => {
                        this.canvas.width = this.video.videoWidth;
                        this.canvas.height = this.video.videoHeight;
                        resolve();
                    });
                };
            });
            
            this.scanning = true;
            this.scan();
        } catch (err) {
            console.error('Error al acceder a la cámara:', err);
            this.cameraContainer.classList.remove('active');
            alert('No se pudo acceder a la cámara: ' + err.message);
        }
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.scanning = false;
        this.video.srcObject = null;
        this.cameraContainer.classList.remove('active');
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.updateProgress(0, null);
    }

    scan() {
        if (!this.scanning || !this.video.srcObject) return;

        this.decoder.decodeFromVideoElement(this.video, (result, err) => {
            if (result) {
                this.detectedQRs = result.resultPoints.map(point => ({
                    x: point.x,
                    y: point.y,
                    width: result.width || 100, // Tamaño estimado si no está disponible
                    height: result.height || 100,
                    text: result.getText()
                }));
                this.handleQRCode(result.getText());
            }
            if (err && !(err instanceof ZXing.NotFoundException)) {
                console.error('Error en el escaneo:', err);
                this.detectedQRs = []; // Limpiar si hay error
            } else if (!result) {
                this.detectedQRs = []; // Limpiar si no se detecta nada
            }

            this.drawOverlay();

            if (this.scanning) {
                requestAnimationFrame(() => this.scan()); // Usar RAF para mejor rendimiento
            }
        });
    }

    drawOverlay() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.detectedQRs.forEach(qr => {
            const parsed = JSON.parse(qr.text);
            const color = this.qrDataMap.has(parsed.index) ? 'limegreen' : 'red';
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(qr.x - qr.width / 2, qr.y - qr.height / 2, qr.width, qr.height);
        });
    }

    handleQRCode(data) {
        try {
            const qrData = JSON.parse(data);
            if (!('index' in qrData) || !('total' in qrData) || !('data' in qrData)) {
                throw new Error('Formato de datos QR inválido');
            }
            if (!this.qrDataMap.has(qrData.index)) {
                this.qrDataMap.set(qrData.index, qrData.data);
                this.totalBlocks = qrData.total;
                this.updateProgress(this.qrDataMap.size, this.totalBlocks);
                console.log(`QR detectado: índice ${qrData.index}, total: ${this.qrDataMap.size}/${this.totalBlocks}`);
            }
            
            if (qrData.index === 0 && this.qrDataMap.size === 1) {
                this.promptPassword();
            }
        } catch (error) {
            console.error('Error al analizar datos QR:', error);
        }
    }

    promptPassword() {
        const password = prompt('Ingrese la contraseña para descifrar los datos (deje en blanco si no hay encriptación):');
        this.password = password || null;
    }

    updateProgress(detected, total) {
        this.progressText.textContent = total 
            ? `Escaneando QR: ${detected} de ${total} detectados` 
            : `Escaneando QR: ${detected} detectados`;
        const percentage = total ? (detected / total) * 100 : 0;
        this.progressBar.style.width = `${percentage}%`;
    }

    async deriveKey(password, salt) {
        const hash = await argon2.hash({
            pass: password,
            salt: salt,
            time: 2,
            mem: 102400,
            parallelism: 8,
            hashLen: 32,
            type: argon2.ArgonType.Argon2id
        });
        return new Uint8Array(hash.hash);
    }

    async decryptData(encryptedData, password) {
        const bytes = new Uint8Array([...window.atob(encryptedData)].map(c => c.charCodeAt(0)));
        const salt = bytes.slice(0, 16);
        const nonce = bytes.slice(16, 28);
        const tag = bytes.slice(28, 44);
        const ciphertext = bytes.slice(44);
        const dataToDecrypt = new Uint8Array([...ciphertext, ...tag]);
        
        const keyMaterial = await this.deriveKey(password, salt);
        const key = await crypto.subtle.importKey(
            "raw",
            keyMaterial,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );
        
        const decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: nonce,
                tagLength: 128
            },
            key,
            dataToDecrypt
        );
        return new Uint8Array(decrypted);
    }

    decompressData(compressedData) {
        try {
            const zstdDecompressed = ZSTD.decompress(compressedData);
            const brotliDecompressed = brotliDecompress(zstdDecompressed);
            return brotliDecompressed;
        } catch (error) {
            throw new Error('Error al descomprimir los datos: ' + error.message);
        }
    }

    async reconstructFile() {
        if (this.qrDataMap.size === 0) {
            alert('No se han escaneado QR codes.');
            return;
        }

        try {
            const encryptedMetadata = this.qrDataMap.get(0);
            if (!encryptedMetadata) {
                throw new Error('Metadato faltante (índice 0).');
            }

            let compressedMetadata;
            if (this.password) {
                if (!this.password && this.qrDataMap.size === 1) {
                    this.promptPassword();
                    if (!this.password) return;
                }
                compressedMetadata = await this.decryptData(encryptedMetadata, this.password);
            } else {
                compressedMetadata = new Uint8Array([...window.atob(encryptedMetadata)].map(c => c.charCodeAt(0)));
            }

            const metadataStr = new TextDecoder().decode(this.decompressData(compressedMetadata));
            const metadata = JSON.parse(metadataStr);
            const fileName = metadata.file_name;
            const expectedHash = metadata.hash;

            if (!this.totalBlocks) {
                throw new Error('No se detectó el total de bloques.');
            }
            this.updateProgress(this.qrDataMap.size, this.totalBlocks);

            const maxIndex = this.totalBlocks - 1;
            let reconstructedData = new Uint8Array();

            for (let i = 1; i <= maxIndex; i++) {
                const encryptedBlock = this.qrDataMap.get(i);
                if (!encryptedBlock) {
                    throw new Error(`Falta el bloque ${i}.`);
                }
                let blockData;
                if (this.password) {
                    const compressedBlock = await this.decryptData(encryptedBlock, this.password);
                    blockData = this.decompressData(compressedBlock);
                } else {
                    const compressedBlock = new Uint8Array([...window.atob(encryptedBlock)].map(c => c.charCodeAt(0)));
                    blockData = this.decompressData(compressedBlock);
                }
                reconstructedData = new Uint8Array([...reconstructedData, ...blockData]);
            }

            const computedHash = sha3_256(reconstructedData);
            if (computedHash !== expectedHash) {
                throw new Error('Verificación de integridad fallida: hashes no coinciden.');
            }

            this.downloadFile(reconstructedData, `SHUMZU_backups/${fileName}`);
            alert('Archivo reconstruido exitosamente. Por favor, guárdelo en la carpeta "SHUMZU_backups".');
            this.cleanup();
        } catch (error) {
            console.error('Error al reconstruir el archivo:', error);
            alert('Error al reconstruir el archivo: ' + error.message);
        }
    }

    downloadFile(data, filename) {
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    cleanup() {
        this.stopCamera();
        this.qrDataMap.clear();
        this.password = null;
        this.totalBlocks = null;
        this.detectedQRs = [];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const scanner = new QRScanner();
});
