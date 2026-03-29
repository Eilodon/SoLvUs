#!/bin/sh
set -e

# Create nginx config for frontend
mkdir -p /var/www/localhost
cp -r /app/packages/frontend/dist/* /var/www/localhost/

# Nginx config
echo 'server {
    listen 80;
    server_name _;
    root /var/www/localhost;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}' > /etc/nginx/http.d/default.conf

# Start nginx
nginx &

# Wait a bit for nginx to start
sleep 2

# Start prover server
exec npm run server
