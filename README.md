# 🏗️ RMC Pro — Plant Management PWA

A Progressive Web App (PWA) for Ready Mix Concrete plant daily operations management.

## 📱 Features

| Module | Description |
|--------|-------------|
| 🏠 Dashboard | Live KPIs, production charts, fleet status, activity feed |
| 🏗️ Production | Batch log, mix grades, plant parameters |
| 🚛 Vehicles | Fleet GPS tracker, TM status, breakdown log |
| ⚡ Electricity | EB meter readings, DG log, equipment load |
| 📦 Materials | Stock inventory, low-stock alerts |
| 🧪 Quality | Cube tests, slump records, NCR management |
| 📋 Delivery | DO tracking, digital challan, signature |
| 📊 Reports | PDF/Excel/WhatsApp report generation |

## 🚀 Deploy in 3 Minutes (GitHub Pages)

### Option A — GitHub Pages (Free)

1. **Fork or upload** this repository to your GitHub account
2. Go to **Settings → Pages**
3. Under **Source**, select `main` branch → `/ (root)`
4. Click **Save**
5. Your app is live at: `https://YOUR-USERNAME.github.io/rmc-pro/`

### Option B — Netlify (Recommended, Free)

1. Go to [netlify.com](https://netlify.com) → Sign up
2. Click **"Add new site" → "Import from Git"**
3. Connect your GitHub account → Select this repo
4. Build command: *(leave empty)*
5. Publish directory: `.` (root)
6. Click **Deploy Site**
7. Live at: `https://rmc-pro.netlify.app`

### Option C — Vercel (Free)

1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
2. Click **"New Project"** → Import this repo
3. Framework preset: **Other**
4. Click **Deploy**

## 📂 Project Structure

```
rmc-pro/
├── index.html          ← Main PWA app (all modules)
├── manifest.json       ← PWA manifest (app name, icons, theme)
├── service-worker.js   ← Offline support & caching
├── icons/              ← App icons for all device sizes
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-144.png
│   ├── icon-152.png
│   ├── icon-192.png
│   ├── icon-384.png
│   └── icon-512.png
└── README.md           ← This file
```

## 📲 Install as App on Phone

### Android
1. Open Chrome → visit your deployed URL
2. Tap the **⋮ menu → "Add to Home Screen"**
3. Or tap the **Install banner** that appears automatically

### iPhone (iOS 16.4+)
1. Open Safari → visit your deployed URL
2. Tap the **Share button (□↑)**
3. Tap **"Add to Home Screen"**

## 🔧 Customization

Edit `index.html` to update:
- **Plant name & location** → Search for `"Plant Name"`
- **Target volume** → Search for `480` (m³/day target)
- **Number of TMs** → Search for vehicle cards section
- **Mix grades** → Update grade options in batch form
- **Alert thresholds** → Settings page form values

## 📡 Next Steps (Production Ready)

To connect real data:

1. **Firebase Realtime DB** — Replace dummy data with live batch entries
2. **Firebase Auth** — Add login with phone OTP for drivers
3. **Push Notifications** — Firebase Cloud Messaging for alerts
4. **GPS Integration** — Google Maps API for live TM tracking
5. **WhatsApp API** — Auto-send delivery challan to customers

## 🏭 Built For

- RMC Plant Managers & Owners
- Shift Engineers
- QC Technicians  
- Transit Mixer Drivers
- Accounts & Dispatch Teams

## 📄 License

MIT License — Free to use and modify for your plant.

---

**Built with ❤️ for the Indian RMC industry**
