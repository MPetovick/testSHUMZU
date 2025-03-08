class QRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.cameraContainer = document.getElementById('cameraContainer');
        this.scanArea = document.getElementById('scanArea');
        this.inactiveOverlay = document.getElementById('inactiveOverlay');
        this.progressText = document.getElementById('progressText');
        this.progressBar = document.getElementById('progressBar');
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.overlayContext = this.overlayCanvas.getContext('2d');
        this.stream = null;
        this.scanning = false;
        this.qrDataMap = new Map();
        this.password = null;
        this.totalBlocks = null;
        if (typeof ZXing === 'undefined') {
            console.error('ZXing no está cargado');
            alert('Error: Librería ZXing no cargada');
            return;
        }
        this.codeReader = new ZXing.BrowserQRCodeReader();
        this.init();
    }

    init() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Este navegador no soporta el acceso a la cámara.');
            return;
        }
        this.cameraContainer.addEventListener('click', () => {
            console.log('Clic en cameraContainer');
            this.toggleCamera();
        });
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
            console.log('Intentando iniciar la cámara');
            this.cameraContainer.classList.add('active');
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                } 
            });
            this.video.srcObject = this.stream;

            await new Promise((resolve, reject) => {
                this.video.onloadedmetadata = () => {
                    console.log('Metadata cargada, reproduciendo video');
                    this.video.play().then(resolve).catch(err => reject('Error al reproducir el video: ' + err));
                };
                this.video.onerror = () => reject('Error al cargar el video');
            });

            this.overlayCanvas.width = this.video.videoWidth;
            this.overlayCanvas.height = this.video.videoHeight;

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
        this.scanArea.classList.remove('active');
        this.updateProgress(0, null);
    }

    async scan() {
        if (!this.scanning) return;
        console.log('Escaneando...');
        try {
            const result = await this.codeReader.decodeFromVideoElement(this.video);
            if (result) {
                console.log('QR detectado:', result.text);
                this.handleQRCode(result.text, result.resultPoints);
                this.drawQRIndicator(result.resultPoints);
                this.scanArea.classList.add('active');
                setTimeout(() => this.scanArea.classList.remove('active'), 1000);
            }
        } catch (error) {
            console.log('Sin QR detectado:', error);
            this.scanArea.classList.remove('active');
        }
        if (this.scanning) {
            requestAnimationFrame(() => this.scan());
        }
    }

    handleQRCode(data, points) {
        try {
            const qrData = JSON.parse(data);
            if (typeof qrData.index !== 'number' || typeof qrData.data !== 'string') {
                throw new Error('Formato de datos QR inválido');
            }
            if (!this.qrDataMap.has(qrData.index)) {
                this.qrDataMap.set(qrData.index, qrData.data);
                this.updateProgress(this.qrDataMap.size, this.totalBlocks);
                console.log(`QR detectado: índice ${qrData.index}, total: ${this.qrDataMap.size}`);
            }
            if (qrData.index === 0 && this.qrDataMap.size === 1) {
                this.promptPassword();
            }
        } catch (error) {
            console.error('Error al analizar datos QR:', error);
        }
    }

    drawQRIndicator(points) {
        this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        this.overlayContext.strokeStyle = '#00FF00';
        this.overlayContext.lineWidth = 2;
        this.overlayContext.beginPath();
        points.forEach((point, index) => {
            if (index === 0) {
                this.overlayContext.moveTo(point.x, point.y);
            } else {
                this.overlayContext.lineTo(point.x, point.y);
            }
        });
        this.overlayContext.closePath();
        this.overlayContext.stroke();
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
            const brotliDecompressed = BrotliDec(zstdDecompressed);
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
            this.totalBlocks = this.qrDataMap.size;
            this.updateProgress(this.qrDataMap.size, this.totalBlocks);

            const maxIndex = Math.max(...this.qrDataMap.keys());
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

            this.downloadFile(reconstructedData, fileName);
            alert('Archivo reconstruido exitosamente.');
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
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM cargado, iniciando QRScanner');
    const scanner = new QRScanner();
});
