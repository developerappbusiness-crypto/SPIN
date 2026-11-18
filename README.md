# Lucky Spin 🎡
Zero-dependency Node.js (18+). Backend + user site + admin panel.

## Run
    ADMIN_PASSWORD=yourpass node server.js   # http://localhost:3000  admin: /admin

## Deploy on Render
New Web Service -> connect repo -> Start command: `node server.js`
Env: ADMIN_PASSWORD (required), DATA_DIR (persistent disk path, else data resets on redeploy).

## Rules
- One account per IP + device. One spin per user and per IP until admin resets.
- 100 points per spin (editable). Only admin gives points.
- Prize chosen on server; odds editable in admin (must total 100).
