const { generarXML, generarClave, generarConsecutivo } = require('./xmlBuilder');
'use strict';
exports.addNC = (onCall, HttpsError, db, storage, obtenerToken, enviarComprobante, esperarRespuesta, firmarXML, getTransporter, getEmailConfig, admin) => {
  return onCall({ enforceAppCheck:false }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated','Debe iniciar sesión');
    const { ventaId, motivo, tipo, montoNC } = request.data;
    try {
      const ventaSnap = await db.collection('sales').doc(ventaId).get();
      if (!ventaSnap.exists) throw new Error('Venta no encontrada');
      const venta = ventaSnap.data();
      if (!venta.facturaId) throw new Error('Esta venta no tiene factura electrónica');
      const feSnap = await db.collection('facturas').doc(venta.facturaId).get();
      if (!feSnap.exists) throw new Error('Factura no encontrada');
      const fe = feSnap.data();
      if (fe.estado!=='aceptado') throw new Error('Solo se puede hacer NC de facturas aceptadas');
      const cfgSnap = await db.collection('config').doc('main').get();
      const cfg = cfgSnap.data();
      const ambiente = cfg.ambienteFE||'stag';
      const fecha = new Date();
      const contRef = db.collection('config').doc('consecutivoNC');
      const nuevoNum = await db.runTransaction(async t => {
        const snap = await t.get(contRef);
        const nuevo = (snap.exists?(snap.data().numero||0):0)+1;
        t.set(contRef,{numero:nuevo,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
        return nuevo;
      });
      const momentCR = require('moment-timezone');
      const fechaCR = momentCR(fecha).tz('America/Costa_Rica');
      const dia = fechaCR.format('DD');
      const mes = fechaCR.format('MM');
      const anio = fechaCR.format('YY');
      const cedula=cfg.cedulaEmisor.padStart(12,'0');
      const seg=Math.floor(Math.random()*99999999).toString().padStart(8,'0');
      const consecNC=`0010000103${nuevoNum.toString().padStart(10,'0')}`;
      const clave=`506${dia}${mes}${anio}${cedula}${consecNC}1${seg}`;
      const consecutivo=consecNC;
      const emisor={nombre:fe.emisor.nombre,cedula:cfg.cedulaEmisor,tipoId:cfg.tipoIdEmisor||cfg.tipoIdentificacion||'01',correo:cfg.correoEmisor,codigoActividad:cfg.codigoActividad,provincia:cfg.provincia||'5',canton:cfg.canton||'03',distrito:cfg.distrito||'01',direccion:cfg.address||'Guanacaste'};
      let itemsNC,totalGravado,totalImpuesto,totalVenta,totalComprobante;
      if (tipo==='total') {
        itemsNC=fe.items||[];totalGravado=fe.totalGravado||0;totalImpuesto=fe.totalImpuesto||0;totalVenta=fe.totalVenta||0;totalComprobante=fe.totalComprobante||0;
      } else {
        const pct=montoNC/fe.totalComprobante;
        itemsNC=(fe.items||[]).map(i=>({...i,qty:parseFloat((i.qty*pct).toFixed(4)),subtotal:parseFloat(((i.subtotal||0)*pct).toFixed(5)),impuesto:parseFloat(((i.impuesto||0)*pct).toFixed(5)),totalLinea:parseFloat(((i.totalLinea||0)*pct).toFixed(5))}));
        totalGravado=parseFloat(((fe.totalGravado||0)*pct).toFixed(5));totalImpuesto=parseFloat(((fe.totalImpuesto||0)*pct).toFixed(5));totalVenta=parseFloat(((fe.totalVenta||0)*pct).toFixed(5));totalComprobante=parseFloat(montoNC.toFixed(5));
      }
      const momentNC = require('moment-timezone'); const fechaStr = momentNC(fecha).tz('America/Costa_Rica').format('YYYY-MM-DDTHH:mm:ss-06:00');
      const escXML = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/’/g,"'").replace(/‘/g,"'").replace(/'/g,'&apos;').replace(/"/g,'&quot;');
      const { create: createXML2 } = require('xmlbuilder2');
      const nsNC = 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica';
      const escX = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const rootNC = createXML2({ version:'1.0', encoding:'UTF-8' })
        .ele('NotaCreditoElectronica', {
          xmlns: nsNC,
          'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
          'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
          'xsi:schemaLocation': `${nsNC} ${nsNC}.xsd`
        });
      rootNC.ele('Clave').txt(clave);
      rootNC.ele('ProveedorSistemas').txt('01');
      rootNC.ele('CodigoActividadEmisor').txt((cfg.codigoActividad||'').replace(',',''));
      rootNC.ele('NumeroConsecutivo').txt(consecutivo);
      rootNC.ele('FechaEmision').txt(fechaStr);
      const emNC = rootNC.ele('Emisor');
      emNC.ele('Nombre').txt(escX(emisor.nombre));
      emNC.ele('Identificacion').ele('Tipo').txt(emisor.tipoId).up().ele('Numero').txt(emisor.cedula);
      if(emisor.nombreComercial) emNC.ele('NombreComercial').txt(escX(emisor.nombreComercial));
      const ubNC = emNC.ele('Ubicacion');
      ubNC.ele('Provincia').txt(emisor.provincia||'5');
      ubNC.ele('Canton').txt(emisor.canton||'02');
      ubNC.ele('Distrito').txt(emisor.distrito||'06');
      ubNC.ele('OtrasSenas').txt(escX(emisor.direccion||'Guanacaste'));
      emNC.ele('CorreoElectronico').txt(emisor.correo);
      if(fe.receptor?.nombre){
        const reNC = rootNC.ele('Receptor');
        reNC.ele('Nombre').txt(escX(fe.receptor.nombre));
        if(fe.receptor.cedula) reNC.ele('Identificacion').ele('Tipo').txt(fe.receptor.tipoId||'01').up().ele('Numero').txt(fe.receptor.cedula);
      }
      rootNC.ele('CondicionVenta').txt('01');
      const detNC = rootNC.ele('DetalleServicio');
      itemsNC.forEach((it,i) => {
        const linNC = detNC.ele('LineaDetalle');
        linNC.ele('NumeroLinea').txt((i+1).toString());
        linNC.ele('CodigoCABYS').txt(it.codigoCABYS||'3835099010000');
        linNC.ele('Cantidad').txt((it.qty||1).toFixed(2));
        linNC.ele('UnidadMedida').txt('Unid');
        linNC.ele('Detalle').txt(escX((it.name||'').substring(0,200)));
        linNC.ele('PrecioUnitario').txt((it.precioUnitarioCRC||it.price||0).toFixed(2));
        linNC.ele('MontoTotal').txt(((it.precioUnitarioCRC||it.price||0)*(it.qty||1)).toFixed(2));
        linNC.ele('SubTotal').txt((it.subtotal||0).toFixed(2));
        linNC.ele('BaseImponible').txt((it.subtotal||0).toFixed(2));
        if((it.impuesto||0)>0){
          const impNC = linNC.ele('Impuesto');
          impNC.ele('Codigo').txt('01');
          impNC.ele('CodigoTarifaIVA').txt('08');
          impNC.ele('Tarifa').txt('13.00');
          impNC.ele('Monto').txt((it.impuesto||0).toFixed(2));
          linNC.ele('ImpuestoNeto').txt((it.impuesto||0).toFixed(2));
        }
        linNC.ele('MontoTotalLinea').txt((it.totalLinea||0).toFixed(2));
      });
      const resNC = rootNC.ele('ResumenFactura');
      resNC.ele('CodigoTipoMoneda').ele('CodigoMoneda').txt('CRC').up().ele('TipoCambio').txt('1.00');
      resNC.ele('TotalServGravados').txt('0.00');
      resNC.ele('TotalServExentos').txt('0');
      resNC.ele('TotalServExonerado').txt('0');
      resNC.ele('TotalServNoSujeto').txt('0');
      resNC.ele('TotalMercanciasGravadas').txt(totalGravado.toFixed(2));
      resNC.ele('TotalMercanciasExentas').txt('0');
      resNC.ele('TotalMercExonerada').txt('0');
      resNC.ele('TotalMercNoSujeta').txt('0');
      resNC.ele('TotalGravado').txt(totalGravado.toFixed(2));
      resNC.ele('TotalExento').txt('0');
      resNC.ele('TotalExonerado').txt('0');
      resNC.ele('TotalVenta').txt(totalVenta.toFixed(2));
      resNC.ele('TotalDescuentos').txt('0.00');
      resNC.ele('TotalVentaNeta').txt(totalVenta.toFixed(2));
      resNC.ele('TotalDesgloseImpuesto').ele('Codigo').txt('01').up().ele('CodigoTarifaIVA').txt('08').up().ele('TotalMontoImpuesto').txt(totalImpuesto.toFixed(2));
      resNC.ele('TotalImpuesto').txt(totalImpuesto.toFixed(2));
      resNC.ele('TotalImpAsumEmisorFabrica').txt('0');
      resNC.ele('TotalIVADevuelto').txt('0');
      resNC.ele('MedioPago').ele('TipoMedioPago').txt((fe.medioPago||['01'])[0]).up().ele('TotalMedioPago').txt(totalComprobante.toFixed(2));
      resNC.ele('TotalComprobante').txt(totalComprobante.toFixed(2));
      const infoRef = rootNC.ele('InformacionReferencia');
      infoRef.ele('TipoDocIR').txt('01');
      infoRef.ele('Numero').txt(fe.clave||venta.facturaClave||fe.consecutivo||'');
      infoRef.ele('FechaEmisionIR').txt(fechaStr);
      infoRef.ele('Codigo').txt('01');
      infoRef.ele('Razon').txt(escX((motivo||'').substring(0,180)));
      const xmlNC = rootNC.end({ prettyPrint:false });
      const p12Ref = storage.bucket().file(`llaves/${cfg.cedulaEmisor}/llave.p12`);
      const [p12Buffer] = await p12Ref.download();
      console.log("NC XML len:", xmlNC.length, "primeros 100:", xmlNC.substring(0,100));
      console.log("NC XML completo:", xmlNC.substring(0,500));
      console.log("NC clave:", clave, "len:", clave.length, "consec:", consecutivo);
      const xmlFirmadoBase64 = await firmarXML(xmlNC, p12Buffer, cfg.pinLlave);
      console.log("NC firmado len:", xmlFirmadoBase64?.length);
      const token = await obtenerToken({usuario:cfg.usuarioHacienda,password:cfg.passwordHacienda,ambiente});
      await enviarComprobante({xmlFirmadoBase64,clave,fecha:fecha.toISOString(),emisorTipo:emisor.tipoId,emisorCedula:emisor.cedula,receptorTipo:fe.receptor?.tipoId,receptorCedula:fe.receptor?.cedula,token,ambiente});
      const ncData={clave,consecutivo,fecha,ventaId,facturaId:venta.facturaId,emisor,receptor:fe.receptor,items:itemsNC,totalGravado,totalImpuesto,totalVenta,totalComprobante,motivo,tipo,ambiente,estado:'procesando',xmlBase64:xmlFirmadoBase64,createdAt:admin.firestore.FieldValue.serverTimestamp(),createdBy:request.auth.uid};
      const ncRef = await db.collection('notascredito').add(ncData);
      const respuesta = await esperarRespuesta({clave,token,ambiente});
      await ncRef.update({estado:respuesta.estado,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
      await db.collection('sales').doc(ventaId).update({notaCreditoId:ncRef.id,notaCreditoEstado:respuesta.estado});
      if (respuesta.estado==='aceptado' && fe.receptor?.correo) {
        await getTransporter().sendMail({from:`"${emisor.nombre}" <${getEmailConfig().user}>`,to:fe.receptor.correo,subject:`Nota de Crédito ${consecutivo}`,html:`<p>Adjunto NC ${consecutivo}. Monto: ₡${Math.round(totalComprobante).toLocaleString('es-CR')}. Motivo: ${motivo}</p><p>POS_IL · Sistemas03il</p>`,attachments:[{filename:`NC_${consecutivo}.xml`,content:Buffer.from(xmlFirmadoBase64,'base64'),contentType:'application/xml'}]});
      }
      return {ok:true,ncId:ncRef.id,clave,consecutivo,estado:respuesta.estado,mensaje:respuesta.estado==='aceptado'?'NC aceptada ✓':respuesta.estado==='rechazado'?'Rechazada: '+(respuesta.mensaje||''):'Enviada, procesando...'};
    } catch(e) { console.error('Error NC:',e); throw new HttpsError('internal',e.message); }
  });
};
