class QRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.cameraContainer = document.getElementById('cameraContainer');
        this.stream = null;
        this.scanning = false;
        this.init();
    }

    init() {
        // Verificar si el navegador soporta getUserMedia
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Este navegador no soporta el acceso a la cámara. Usa una versión más reciente.');
            return;
        }
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
            const constraints = { video: {} };
            const isPC = !/Mobi|Android/i.test(navigator.userAgent); // Detecta si es un PC

            // Si es un PC, no especificamos facingMode (usa la cámara disponible)
            if (!isPC) {
                constraints.video.facingMode = 'environment'; // Cámara trasera en móviles
            }

            // Configuraciones adicionales si son soportadas
            const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
            if (supportedConstraints.focusMode) {
                constraints.video.focusMode = 'continuous';
            }
            if (supportedConstraints.focusDistance) {
                constraints.video.focusDistance = { ideal: 0.1 }; // Distancia ideal para QR
            }
            constraints.video.width = { ideal: Math.min(window.innerWidth, 1280) };
            constraints.video.height = { ideal: Math.min(window.innerHeight, 720) };

            this.cameraContainer.classList.add('active');
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);

            this.video.srcObject = this.stream;
            await this.video.play();
            this.startQRScan();
        } catch (error) {
            console.error('Error al acceder a la cámara:', error);
            this.cameraContainer.classList.remove('active');
            if (error.name === 'NotAllowedError') {
                alert('No se tienen permisos para acceder a la cámara. Habilítalos en el navegador.');
            } else if (error.name === 'NotFoundError') {
                alert('No se encontró una cámara en el dispositivo.');
            } else {
                alert('Error al activar la cámara: ' + error.message);
            }
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
