class QRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.cameraContainer = document.getElementById('cameraContainer');
        this.stream = null;
        this.scanning = false;
        this.init();
    }

    init() {
        this.cameraContainer.addEventListener('click', () => this.toggleCamera());
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
            const constraints = { video: { facingMode: 'environment' } };
            const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();

            // Configuración de enfoque automático si es soportada
            if (supportedConstraints.focusMode) {
                constraints.video.focusMode = 'continuous';
            }
            if (supportedConstraints.focusDistance) {
                constraints.video.focusDistance = { ideal: 0.1 }; // Distancia ideal de 10 cm para QR
            }
            constraints.video.width = { ideal: Math.min(window.innerWidth, 1280) };
            constraints.video.height = { ideal: Math.min(window.innerHeight, 720) };

            // Configuraciones avanzadas para mejor calidad de imagen
            if (supportedConstraints.whiteBalanceMode && supportedConstraints.exposureMode) {
                constraints.video.advanced = [{
                    focusMode: 'continuous',
                    whiteBalanceMode: 'auto',
                    exposureMode: 'auto'
                }];
            }

            this.cameraContainer.classList.add('active');
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);

            this.video.srcObject = this.stream;
            await this.video.play();
            this.startQRScan();
        } catch (error) {
            console.error('Error accessing camera:', error);
            this.cameraContainer.classList.remove('active');
        }
    }

    stopCamera() {
        this.scanning = false;
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.video.srcObject = null;
        this.cameraContainer.classList.remove('active');
    }

    startQRScan() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        this.scanning = true;

        const scanFrame = () => {
            if (!this.scanning) return;

            canvas.width = this.video.videoWidth;
            canvas.height = this.video.videoHeight;
            ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, canvas.width, canvas.height);
            
            if (code) {
                console.log('QR Code detected:', code.data);
                // Aquí puedes manejar el código QR detectado
            }

            requestAnimationFrame(scanFrame);
        };
        scanFrame();
    }

    cleanup() {
        if (this.stream) this.stopCamera();
    }
}

// Inicializa el escáner cuando el DOM esté cargado
document.addEventListener('DOMContentLoaded', () => new QRScanner());
