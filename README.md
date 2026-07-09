# POS_IL — Sistema de Punto de Venta + Factura Electrónica CR

**Desarrollado por [Sistemas03il](https://sistemas03ilcr.com)**  
**Contacto:** sistemas03il@outlook.com | WhatsApp: +506 6452-0450

---

## ¿Qué es POS_IL?

POS_IL es un sistema completo de punto de venta (POS) con **factura electrónica integrada directamente con Hacienda Costa Rica (TRIBU-CR v4.4)**. Funciona como Progressive Web App (PWA) — sin instalar nada, desde cualquier celular, tablet o computadora.

### Características principales

| Módulo | Descripción |
|--------|-------------|
| 🛒 **Caja / POS** | Ventas rápidas, descuentos, múltiples métodos de pago (efectivo, tarjeta, Sinpe, mixto) |
| 📦 **Inventario** | Control de stock en tiempo real, alertas, categorías, código CABYS, importación Excel |
| 🧾 **Factura Electrónica** | Generación, firma XAdES-BES y envío directo a Hacienda CR v4.4 |
| 📝 **Nota de Crédito** | Emisión electrónica desde el historial de ventas |
| 👥 **Clientes / CRM** | Historial de compras, datos fiscales por cliente |
| 🚚 **Proveedores** | Catálogo de proveedores |
| 💸 **Gastos** | Registro de gastos, lectura automática de XML de proveedores |
| 📊 **Reportes** | Ventas por día, productos más vendidos, métodos de pago, KPIs |
| 🧮 **Resumen Contable** | IVA cobrado, IVA acreditable, utilidad estimada, exportar Excel |
| 📋 **Dashboard FE** | Estado visual de facturas electrónicas (aceptadas/rechazadas/procesando) |
| 👤 **Multiusuario** | Roles (admin, cajero, contador) con acceso simultáneo |

---

## Tecnología

- **Frontend:** HTML5 + JavaScript puro (sin frameworks) — PWA
- **Backend:** Google Firebase (Firestore, Auth, Storage, Cloud Functions)
- **Hosting:** Netlify
- **Factura Electrónica:** API TRIBU-CR v4.4, firma XAdES-BES con `haciendacostarica-signer`
- **PDF:** PDFKit (Cloud Functions)
- **Email:** Nodemailer + Gmail App Password

---

## Arquitectura

```
┌─────────────────────────────────────┐
│         Cliente (Navegador)         │
│      index.html — PWA/Firebase      │
└──────────────┬──────────────────────┘
               │ Firebase SDK
┌──────────────▼──────────────────────┐
│           Google Firebase           │
│  ┌──────────┐ ┌──────────────────┐  │
│  │Firestore │ │  Cloud Functions │  │
│  │  Auth    │ │  emitirFactura   │  │
│  │  Storage │ │  emitirNotaCredit│  │
│  └──────────┘ └────────┬─────────┘  │
└───────────────────────┼─────────────┘
                        │ HTTPS
┌───────────────────────▼─────────────┐
│      API Hacienda Costa Rica        │
│         TRIBU-CR v4.4               │
│  (prod.comprobanteselectronicos     │
│         .go.cr)                     │
└─────────────────────────────────────┘
```

---

## Estructura del proyecto

```
posil/
├── index.html                    # App principal (PWA)
├── README.md                     # Este archivo
├── GUIA_NUEVO_CLIENTE.md         # Guía de implementación por cliente
├── setup_cliente_nuevo.sh        # Script automatización nuevo cliente
│
└── functions/                    # Cloud Functions (Firebase)
    ├── index.js                  # Función principal emitirFactura
    ├── xmlBuilder.js             # Generador XML v4.4
    ├── signer.js                 # Firma XAdES-BES (haciendacostarica-signer)
    ├── haciendaAPI.js            # OAuth2 + envío/consulta Hacienda
    ├── pdfGenerator.js           # Generador PDF con PDFKit
    ├── ncFunction.js             # Nota de Crédito Electrónica
    └── package.json              # Dependencias Node.js
```

---

## Cloud Functions desplegadas

| Función | Descripción |
|---------|-------------|
| `emitirFactura` | Genera, firma y envía factura a Hacienda |
| `consultarFactura` | Consulta el estado de una factura en Hacienda |
| `reenviarFactura` | Reenvía la factura por correo |
| `verificarP12` | Verifica la llave criptográfica .p12 |
| `verificarFacturasPendientes` | Verifica facturas en estado procesando |
| `emitirNotaCredito` | Genera y envía nota de crédito electrónica |

---

## Dependencias principales (functions/package.json)

```json
{
  "haciendacostarica-signer": "^x.x.x",
  "xmlbuilder2": "^3.x.x",
  "pdfkit": "^0.x.x",
  "nodemailer": "^6.x.x",
  "axios": "^1.x.x",
  "moment-timezone": "^0.x.x",
  "node-forge": "^1.x.x",
  "xmldom": "^0.x.x"
}
```

---

## Variables de entorno (Firebase Secrets)

| Secret | Descripción |
|--------|-------------|
| `EMAIL_USER` | Correo Gmail para envío de facturas |
| `EMAIL_PASS` | App Password de Gmail (16 caracteres) |

---

## Estructura Firestore

### Colección `config`

**Documento `main`** — Configuración del negocio y datos fiscales:
```javascript
{
  // Datos del negocio
  storeName: "Nombre del Negocio",
  storePhone: "88001122",
  storeEmail: "info@negocio.cr",
  storeAddress: "Ciudad, Provincia",
  storeSlogan: "",
  storeWeb: "",
  storeIBAN: "",
  ticketMsg: "¡Gracias por su compra!",
  defMoneda: "CRC",        // CRC o USD
  tc: 520,                 // Tipo de cambio
  lowStock: 5,             // Umbral alerta stock bajo
  maxDesc: 20,             // Descuento máximo %

  // Datos Factura Electrónica
  cedulaEmisor: "503570258",
  tipoIdentificacion: "01",  // 01=física, 02=jurídica
  codigoActividad: "4649.3", // Formato TRIBU-CR con punto
  correoEmisor: "factura@negocio.cr",
  usuarioHacienda: "cpf-05-0357-0258@prod.comprobanteselectronicos.go.cr",
  passwordHacienda: "password_hacienda",
  pinLlave: "1234",
  ambienteFE: "prod",        // prod o stag
  provincia: "5",
  canton: "02",
  distrito: "06"
}
```

**Documento `consecutivo`** — Contador de facturas:
```javascript
{ numero: 9000 }  // Iniciar en número seguro para evitar duplicados
```

### Colección `users`
```javascript
// Documento con UID del usuario como ID
{
  role: "admin",    // admin, cajero, contador
  nombre: "Nombre",
  email: "email@ejemplo.com"
}
```

### Colección `products`
```javascript
{
  name: "Nombre del producto",
  cat: "Categoría",
  barcode: "7401234567890",
  currency: "CRC",           // CRC o USD
  cost: 5000,
  price: 8000,
  stock: 25,
  supplier: "Proveedor S.A.",
  codigoCABYS: "4641100000000",  // 13 dígitos — obligatorio para FE
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Colección `sales`
```javascript
{
  items: [...],
  totalCRC: 114130,
  totalImpuesto: 13130,
  metodoPago: ["Efectivo"],
  cliente: { nombre: "...", cedula: "...", correo: "..." },
  tipoDoc: "factura",        // factura o ticket
  facturaEstado: "aceptado", // solo si tipoDoc=factura
  facturaConsecutivo: "00100001010000009014",
  facturaClave: "506...",
  createdAt: Timestamp
}
```

### Colección `facturas`
```javascript
{
  clave: "50608072600050357025800100001010000009014...",
  consecutivo: "00100001010000009014",
  fecha: Timestamp,
  emisor: { nombre, cedula, tipoId, ... },
  receptor: { nombre, cedula, tipoId, correo },
  items: [...],
  totalComprobante: 114130,
  totalImpuesto: 13130,
  estado: "aceptado",        // aceptado, rechazado, procesando
  xmlBase64: "...",
  pdfPath: "facturas/ID/factura.pdf",
  ambiente: "prod",
  createdAt: Timestamp
}
```

---

## Reglas de Firestore

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuth() { return request.auth != null; }
    function isAdmin() {
      return isAuth() && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /config/{doc}      { allow read: if isAuth(); allow write: if isAdmin(); }
    match /sales/{doc}       { allow read, write: if isAuth(); }
    match /products/{doc}    { allow read, write: if isAuth(); }
    match /clients/{doc}     { allow read, write: if isAuth(); }
    match /suppliers/{doc}   { allow read, write: if isAuth(); }
    match /users/{doc}       { allow read: if isAuth(); allow write: if isAdmin(); }
    match /facturas/{doc}    { allow read, write: if isAuth(); }
    match /notascredito/{doc}{ allow read: if isAuth(); allow write: if false; }
    match /gastos/{doc}      { allow read, create, update: if isAuth(); allow delete: if isAdmin(); }
  }
}
```

## Reglas de Storage

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /llaves/{cedula}/{archivo} {
      allow read, write: if request.auth != null;
    }
    match /facturas/{facturaId}/{archivo} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

---

## Implementación para un nuevo cliente

### Requisitos previos del cliente para Factura Electrónica

- [ ] Archivo `.p12` (llave criptográfica — se obtiene en SINPE/Hacienda)
- [ ] PIN del `.p12`
- [ ] Usuario Hacienda (formato: `cpf-XX-XXXX-XXXX@prod.comprobanteselectronicos.go.cr`)
- [ ] Password Hacienda
- [ ] Cédula exacta como aparece en TRIBU-CR
- [ ] Tipo de cédula (01=física, 02=jurídica)
- [ ] Código actividad CIIU4 con punto (ej: `4649.3`)
- [ ] Provincia, cantón y distrito — códigos numéricos oficiales
- [ ] Gmail para facturación con App Password activado (16 caracteres)

### Pasos de implementación

**1. Crear proyecto Firebase**
```bash
# En console.firebase.google.com
# Nuevo proyecto → Activar: Firestore, Auth, Storage, Cloud Functions
# Plan Blaze (requerido para Cloud Functions)
```

**2. Configurar en Cloud Shell**
```bash
# Copiar functions al nuevo proyecto
cp -r ~/posil-fe ~/posil-CLIENTE
cd ~/posil-CLIENTE

# Cambiar proyecto
firebase use PROYECTO_ID

# Configurar secrets
firebase functions:secrets:set EMAIL_USER
firebase functions:secrets:set EMAIL_PASS

# Desplegar
firebase deploy --only functions
```

**3. Subir llave .p12 a Storage**
```
Firebase Console → Storage → Crear carpeta:
llaves/CEDULA_CLIENTE/llave.p12
```

**4. Configurar Firestore**
- Crear documento `config/main` con todos los datos fiscales
- Crear documento `config/consecutivo` con `{ numero: 1 }`
- Crear usuario en Auth y documento en `users/{UID}` con `{ role: "admin" }`

**5. Actualizar index.html**
```javascript
// Cambiar solo el firebaseConfig:
const firebaseConfig = {
  apiKey: "NUEVO_API_KEY",
  authDomain: "NUEVO_PROJECT.firebaseapp.com",
  projectId: "NUEVO_PROJECT_ID",
  storageBucket: "NUEVO_PROJECT.firebasestorage.app",
  messagingSenderId: "NUEVO_SENDER_ID",
  appId: "NUEVO_APP_ID"
};
```

**6. Subir a Netlify**
```
app.netlify.com → Add new site → Deploy manually
Configurar dominio del cliente
```

---

## Estructura de la clave numérica (Artículo 5, Resolución DGT-R-48-2016)

```
País(3) + Día(2) + Mes(2) + Año(2) + Cédula(12) + Consecutivo(20) + Situación(1) + Seguridad(8) = 50 dígitos

Ejemplo:
506  08  07  26  000503570258  00100001010000009014  1  12345678
```

### Estructura del consecutivo (20 dígitos)
```
Sucursal(3) + Terminal(5) + TipoDoc(2) + Número(10) = 20 dígitos
001          00001          01           0000009014

TipoDoc: 01=Factura, 02=Tiquete, 03=Nota Crédito, 04=Nota Débito
```

---

## Códigos de actividad CIIU4 — Formato TRIBU-CR

Los códigos de actividad deben usar el **formato con punto** exactamente como aparece en TRIBU-CR:
- `4649.3` — Venta al por mayor de juguetes y artículos deportivos
- `4620.0` — Venta al por mayor de materias primas agropecuarias
- `6202.0` — Actividades de consultoría informática

> ⚠️ El código mínimo es de 6 caracteres incluyendo el punto (ej: `4649.3`)

---

## Código CABYS

Cada producto debe tener un código CABYS de **13 dígitos** del catálogo oficial del BCCR.

Consultar en: **https://www.bccr.fi.cr → Indicadores económicos → Catálogo de bienes y servicios**

El campo `codigoCABYS` es obligatorio para la Factura Electrónica v4.4.

---

## Gmail — App Password

Para el envío de correos el sistema requiere un **App Password** de Gmail (no la contraseña normal):

1. Cuenta Google → Seguridad → Verificación en 2 pasos (activar)
2. Seguridad → Contraseñas de aplicaciones
3. Seleccionar "Correo" → Generar
4. Copiar los 16 caracteres → guardar como secret `EMAIL_PASS`

---

## Usuarios y roles

| Rol | Acceso |
|-----|--------|
| `admin` | Todo el sistema incluyendo Ajustes, eliminación de datos |
| `cajero` | Caja, Historial, Inventario (sin eliminar) |
| `contador` | Reportes, Historial, Gastos (solo lectura en ventas) |

---

## Campos útiles de referencia

### Provincia → Cantón → Distrito (códigos)
- Guanacaste (5) → Nicoya (02) → Nosara (06)
- San José (1) → Central (01) → Carmen (01)

Consultar tabla completa en: https://www.hacienda.go.cr/

---

## Soporte y contacto

**Sistemas03il**  
- 📱 WhatsApp: +506 6452-0450  
- 📧 sistemas03il@outlook.com  
- 🌐 sistemas03ilcr.com  
- 💻 Demo: posilcr.online

---

## Licencia

Sistema propietario desarrollado por Sistemas03il.  
Prohibida la redistribución sin autorización escrita.

© 2026 Sistemas03il. Todos los derechos reservados.
