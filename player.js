// Player Controls Module - Quality and Speed Management
class PlayerControls {
    constructor(videoElement) {
        this.video = videoElement;
        this.qualityLevels = [];
        this.initControls();
    }
    
    initControls() {
        // Speed control is handled in main script
        this.setupKeyboardShortcuts();
    }
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (!this.video) return;
            
            switch(e.key) {
                case 'ArrowLeft':
                    this.video.currentTime = Math.max(0, this.video.currentTime - 5);
                    showNotification(`Rewind 5s`, 'info');
                    e.preventDefault();
                    break;
                case 'ArrowRight':
                    this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 5);
                    showNotification(`Forward 5s`, 'info');
                    e.preventDefault();
                    break;
                case 'ArrowUp':
                    this.video.volume = Math.min(1, this.video.volume + 0.1);
                    showNotification(`Volume: ${Math.round(this.video.volume * 100)}%`, 'info');
                    e.preventDefault();
                    break;
                case 'ArrowDown':
                    this.video.volume = Math.max(0, this.video.volume - 0.1);
                    showNotification(`Volume: ${Math.round(this.video.volume * 100)}%`, 'info');
                    e.preventDefault();
                    break;
                case ' ':
                case 'Space':
                    if (this.video.paused) {
                        this.video.play();
                        showNotification('Playing', 'info');
                    } else {
                        this.video.pause();
                        showNotification('Paused', 'info');
                    }
                    e.preventDefault();
                    break;
                case 'f':
                case 'F':
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                        showNotification('Exit Fullscreen', 'info');
                    } else {
                        this.video.requestFullscreen();
                        showNotification('Fullscreen', 'info');
                    }
                    e.preventDefault();
                    break;
            }
        });
    }
    
    setQuality(level) {
        // Quality selection handled by player implementation
        console.log('Quality set to:', level);
    }
    
    setSpeed(speed) {
        if (this.video) {
            this.video.playbackRate = speed;
        }
    }
}

// Export for use
window.PlayerControls = PlayerControls;