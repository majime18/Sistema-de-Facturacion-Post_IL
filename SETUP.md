# Setup rápido — POS_IL

## Para el repositorio GitHub necesita estos archivos:

```
posil/
├── index.html          ← La app completa
├── README.md           ← Documentación
├── SETUP.md            ← Este archivo
├── GUIA_NUEVO_CLIENTE.md
├── setup_cliente_nuevo.sh
├── .gitignore
└── functions/
    ├── index.js
    ├── xmlBuilder.js
    ├── signer.js
    ├── haciendaAPI.js
    ├── pdfGenerator.js
    ├── ncFunction.js
    ├── package.json
    └── .eslintrc.json
```

## ⚠️ NUNCA subir al repo:
- Archivos `.p12` (llaves criptográficas)
- Contraseñas de Hacienda
- App Passwords de Gmail
- El archivo `.firebaserc` con el project ID del cliente

## Comandos Git básicos:

```bash
# Primera vez
git init
git add .
git commit -m "POS_IL v1.0 — Sistema POS + FE Costa Rica"
git branch -M main
git remote add origin https://github.com/USUARIO/posil.git
git push -u origin main

# Actualizar
git add .
git commit -m "descripcion del cambio"
git push
```

## Para un cliente nuevo:
1. Clonar repo: `git clone https://github.com/USUARIO/posil.git posil-CLIENTE`
2. Cambiar firebaseConfig en index.html
3. Cambiar proyecto Firebase: `firebase use PROYECTO_CLIENTE`
4. Deploy: `firebase deploy --only functions`
5. Subir index.html a Netlify del cliente
