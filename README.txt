DJ Capital – eigene App

Dateien:
  index.html, app.js, style.css   die App
  manifest.webmanifest, icon-*.png, apple-touch-icon.png   Name und Logo für den Home-Bildschirm
  sw.js   macht die App offline nutzbar
  lib/    PDF-Leser (pdf.js 3.11.174, Mozilla, Apache-2.0-Lizenz)

Alle Daten bleiben auf dem Gerät (im Browser-Speicher). Nichts wird an einen Server geschickt.
Bei einem Update: neue Dateien hochladen und in sw.js die VERSION erhöhen.
