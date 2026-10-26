#!/bin/bash
# MeTube One-Click Setup Script for Ubuntu / Debian on Oracle Cloud Always Free
set -e

echo "=== 1. Updating System Packages ==="
sudo apt-get update && sudo apt-get upgrade -y

echo "=== 2. Installing Dependencies (Python, FFMPEG, Node.js, Nginx, Certbot) ==="
sudo apt-get install -y python3 python3-pip python3-venv ffmpeg nodejs npm git curl ufw nginx certbot python3-certbot-nginx

echo "=== 3. Setting Up Project Directory ==="
cd /home/ubuntu
if [ ! -d "Me-tube" ]; then
    git clone https://github.com/HR1244/Me-tube.git
else
    cd Me-tube && git pull && cd ..
fi

cd /home/ubuntu/Me-tube/server

echo "=== 4. Creating Python Virtual Environment ==="
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

mkdir -p downloads

echo "=== 5. Creating Systemd Service for 24/7 Background Run ==="
sudo bash -c 'cat > /etc/systemd/system/metube.service << "EOF"
[Unit]
Description=MeTube FastAPI Backend Server
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/Me-tube/server
ExecStart=/home/ubuntu/Me-tube/server/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=5
Environment=PORT=8000

[Install]
WantedBy=multi-user.target
EOF'

sudo systemctl daemon-reload
sudo systemctl enable metube
sudo systemctl restart metube

echo "=== 6. Configuring Firewall (UFW & iptables) ==="
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Oracle Cloud uses custom iptables rules by default on Ubuntu images
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
sudo netfilter-persistent save || true

echo "=== 7. Configuring Nginx Reverse Proxy ==="
sudo bash -c 'cat > /etc/nginx/sites-available/metube << "EOF"
server {
    listen 80;
    server_name _;

    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for smooth video streaming and downloads
        proxy_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF'

sudo ln -sf /etc/nginx/sites-available/metube /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

echo ""
echo "=========================================================="
echo "  MeTube Server is UP and Running!"
echo "  Access it at: http://$(curl -s ifconfig.me)"
echo "=========================================================="
