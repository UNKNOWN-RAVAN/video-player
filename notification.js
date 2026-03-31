// Notification Module - Toast Messages
class NotificationManager {
    constructor() {
        this.toastElement = null;
        this.timeout = null;
        this.init();
    }
    
    init() {
        this.toastElement = document.getElementById('notificationToast');
        if (!this.toastElement) {
            this.toastElement = document.createElement('div');
            this.toastElement.id = 'notificationToast';
            document.body.appendChild(this.toastElement);
        }
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .notification-toast {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #333;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                font-size: 14px;
                z-index: 10001;
                opacity: 0;
                transform: translateY(20px);
                transition: all 0.3s ease;
                pointer-events: none;
                max-width: 300px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
            .notification-toast.show {
                opacity: 1;
                transform: translateY(0);
            }
            .notification-toast.success {
                background: #28a745;
            }
            .notification-toast.error {
                background: #dc3545;
            }
            .notification-toast.info {
                background: #17a2b8;
            }
            .notification-toast.loading {
                background: #ffc107;
                color: #333;
            }
            .download-modal input {
                font-family: monospace;
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
    }
    
    show(message, type = 'info', duration = 3000) {
        if (this.timeout) clearTimeout(this.timeout);
        
        this.toastElement.textContent = message;
        this.toastElement.className = `notification-toast ${type} show`;
        
        this.timeout = setTimeout(() => {
            this.toastElement.classList.remove('show');
        }, duration);
    }
}

// Initialize notification manager
const notification = new NotificationManager();

function showNotification(message, type = 'info', duration = 3000) {
    notification.show(message, type, duration);
}