'use strict';
// Archivo de debug temporal
exports.debugFE = (data) => {
  console.log('DEBUG items:', JSON.stringify(data.items));
  console.log('DEBUG emisor cedulaEmisor:', data.cedulaEmisor);
  console.log('DEBUG codigoActividad:', data.codigoActividad);
};
