// Downloader Module - Handle video downloads
class VideoDownloader {
    constructor() {
        this.supportedTypes = ['mp4', 'mpd', 'm3u8', 'mkv', 'webm'];
    }
    
    async download(url, type, filename = 'video') {
        try {
            showNotification('Starting download...', 'loading');
            
            if (type === 'mpd' || type === 'm3u8') {
                this.downloadStreamingVideo(url, type, filename);
            } else if (type === 'mp4') {
                await this.downloadDirectVideo(url, filename);
            } else {
                await this.downloadDirectVideo(url, filename);
            }
        } catch (error) {
            console.error('Download error:', error);
            showNotification(`Download failed: ${error.message}`, 'error');
        }
    }
    
    async downloadDirectVideo(url, filename) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${filename}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(blobUrl);
            
            showNotification('Download complete!', 'success');
        } catch (error) {
            // Fallback: open in new tab for direct download
            window.open(url, '_blank');
            showNotification('Opening video in new tab for download', 'info');
        }
    }
    
    downloadStreamingVideo(url, type, filename) {
        // For streaming videos, provide links to manifest
        showNotification(`Streaming video (${type.toUpperCase()}) - Use external tools like yt-dlp to download`, 'info');
        
        // Create info modal with instructions
        this.showStreamingInfo(url, type, filename);
    }
    
    showStreamingInfo(url, type, filename) {
        const modal = document.createElement('div');
        modal.className = 'download-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>📥 Streaming Video Download</h3>
                <p>For ${type.toUpperCase()} streams, use professional tools:</p>
                <ul>
                    <li><strong>yt-dlp</strong>: <code>yt-dlp "${url}"</code></li>
                    <li><strong>ffmpeg</strong>: <code>ffmpeg -i "${url}" -c copy output.mp4</code></li>
                </ul>
                <p><strong>Manifest URL:</strong></p>
                <input type="text" value="${url}" readonly style="width:100%; padding:8px; margin:10px 0;">
                <button onclick="this.parentElement.parentElement.remove()" class="btn-primary">Close</button>
            </div>
        `;
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        modal.querySelector('.modal-content').style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 12px;
            max-width: 500px;
            width: 90%;
        `;
        document.body.appendChild(modal);
        
        // Copy button
        const input = modal.querySelector('input');
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋 Copy URL';
        copyBtn.style.marginTop = '10px';
        copyBtn.onclick = () => {
            input.select();
            document.execCommand('copy');
            showNotification('URL copied to clipboard', 'success');
        };
        modal.querySelector('.modal-content').appendChild(copyBtn);
    }
}

// Global download function
const downloader = new VideoDownloader();

function downloadVideo(url, type, filename) {
    if (!url) {
        showNotification('No video URL available', 'error');
        return;
    }
    downloader.download(url, type, filename);
}