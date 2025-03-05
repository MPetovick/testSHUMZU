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
            this.cameraContainer.classList.add('active');
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: Math.min(window.innerWidth, 1280) },
                    height: { ideal: Math.min(window.innerHeight, 720) }
                }
            });
            
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
                // Handle detected QR code here
            }

            requestAnimationFrame(scanFrame);
        };
        scanFrame();
    }

    cleanup() {
        if (this.stream) this.stopCamera();
    }
}

// Initialize scanner when DOM is loaded
document.addEventListener('DOMContentLoaded', () => new QRScanner());
