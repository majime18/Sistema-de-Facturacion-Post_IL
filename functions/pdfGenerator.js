'use strict';
const PDFDocument = require('pdfkit');

function fmCRC(n) { return '₡' + Math.round(n||0).toLocaleString('es-CR'); }

async function generarPDF(datos) {
  return new Promise((resolve, reject) => {
    try {
      const { clave, consecutivo, fecha, emisor, receptor, items, totalGravado, totalExento, totalImpuesto, totalDescuento=0, totalComprobante, condicionVenta='01', medioPago=['01'], estado='aceptado', tipoDoc='01' } = datos;
      const doc = new PDFDocument({ size:'A4', margin:40 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const W = doc.page.width - 80;
      const MORADO = '#6366f1', GRIS = '#6b7280', NEGRO = '#111827';
      doc.rect(0,0,doc.page.width,8).fill(MORADO);
      doc.fontSize(20).font('Helvetica-Bold').fillColor(MORADO).text(emisor.nombre, 40, 22);
      doc.fontSize(9).font('Helvetica').fillColor(GRIS).text(`Cédula: ${emisor.cedula}`).text(emisor.direccion||'').text(`Tel: ${emisor.telefono||''} · ${emisor.correo||''}`);
      const tipoLabel = tipoDoc==='01' ? 'FACTURA ELECTRÓNICA' : 'TIQUETE ELECTRÓNICO';
      doc.fontSize(13).font('Helvetica-Bold').fillColor(NEGRO).text(tipoLabel, 40, 22, { align:'right', width:W });
      doc.fontSize(9).font('Helvetica').fillColor(GRIS).text(`N° ${consecutivo}`, { align:'right', width:W+40 });
      const fechaFmt = new Date(fecha).toLocaleString('es-CR', { timeZone:'America/Costa_Rica', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      doc.text(`Fecha: ${fechaFmt}`, { align:'right', width:W+40 });
      const estadoColor = estado==='aceptado' ? '#059669' : estado==='rechazado' ? '#dc2626' : '#d97706';
      const estadoLabel = estado==='aceptado' ? '✓ ACEPTADA POR HACIENDA' : estado==='rechazado' ? '✗ RECHAZADA' : '⏳ PROCESANDO';
      doc.fontSize(9).font('Helvetica-Bold').fillColor(estadoColor).text(estadoLabel, { align:'right', width:W+40 });
      doc.moveDown(0.5);
      doc.moveTo(40,doc.y).lineTo(doc.page.width-40,doc.y).stroke(MORADO);
      doc.moveDown(0.5);
      const yDatos = doc.y, colW = W/2-10;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MORADO).text('EMISOR', 40, yDatos);
      doc.fontSize(9).font('Helvetica').fillColor(NEGRO).text(emisor.nombre, 40, doc.y+2, {width:colW}).text(`Cédula: ${emisor.cedula}`, {width:colW}).text(`Actividad: ${emisor.codigoActividad}`, {width:colW});
      if (receptor?.nombre) {
        const xR = 40+colW+20;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(MORADO).text('RECEPTOR', xR, yDatos);
        doc.fontSize(9).font('Helvetica').fillColor(NEGRO).text(receptor.nombre, xR, doc.y+2, {width:colW}).text(`Cédula: ${receptor.cedula||'—'}`, {width:colW}).text(`Correo: ${receptor.correo||'—'}`, {width:colW});
      }
      doc.moveDown(1);
      doc.moveTo(40,doc.y).lineTo(doc.page.width-40,doc.y).stroke('#e5e7eb');
      doc.moveDown(0.5);
      doc.rect(40,doc.y,W,16).fill(MORADO);
      const yH = doc.y+4;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff').text('Cant.',40,yH,{width:35}).text('Detalle',80,yH,{width:270}).text('Precio',355,yH,{width:65,align:'right'}).text('IVA',425,yH,{width:55,align:'right'}).text('Total',485,yH,{width:65,align:'right'});
      doc.moveDown(0.2);
      items.forEach((item,i) => {
        const yR = doc.y+2;
        if (i%2===0) doc.rect(40,doc.y,W,18).fill('#f9fafb');
        doc.fontSize(8).font('Helvetica').fillColor(NEGRO).text(item.qty.toString(),40,yR,{width:35}).text(item.name.substring(0,55),80,yR,{width:270}).text(fmCRC(item.precioUnitarioCRC||item.price),355,yR,{width:65,align:'right'}).text(fmCRC(item.impuesto||0),425,yR,{width:55,align:'right'}).text(fmCRC(item.totalLinea),485,yR,{width:65,align:'right'});
        doc.moveDown(0.3);
      });
      doc.moveTo(40,doc.y).lineTo(doc.page.width-40,doc.y).stroke('#e5e7eb');
      doc.moveDown(0.5);
      const xT = doc.page.width-200;
      const fila = (label,valor,bold=false,color=NEGRO) => { const y=doc.y; doc.fontSize(9).font(bold?'Helvetica-Bold':'Helvetica').fillColor(GRIS).text(label,xT,y,{width:100}).fillColor(color).text(fmCRC(valor),xT+100,y,{width:65,align:'right'}); doc.moveDown(0.3); };
      fila('Subtotal gravado:',totalGravado);
      if (totalDescuento>0) fila('Descuento:',totalDescuento);
      fila('IVA 13%:',totalImpuesto);
      doc.moveTo(xT,doc.y).lineTo(doc.page.width-40,doc.y).stroke(MORADO);
      doc.moveDown(0.2);
      fila('TOTAL:',totalComprobante,true,MORADO);
      doc.moveDown(1);
      doc.rect(40,doc.y,W,28).fill('#f3f4f6');
      const yQ = doc.y+4;
      doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS).text('CLAVE NUMÉRICA:',45,yQ);
      doc.fontSize(7).font('Helvetica').fillColor(NEGRO).text(clave,45,yQ+10,{width:W-10});
      doc.moveDown(2);
      doc.fontSize(7).font('Helvetica').fillColor(GRIS).text('Documento generado por POS_IL · Sistemas03il · posilcr.online · WhatsApp 6452-0450\nComprobante electrónico autorizado por el Ministerio de Hacienda de Costa Rica.',40,doc.y,{align:'center',width:W});
      doc.rect(0,doc.page.height-8,doc.page.width,8).fill(MORADO);
      doc.end();
    } catch(e) { reject(e); }
  });
}

module.exports = { generarPDF };
