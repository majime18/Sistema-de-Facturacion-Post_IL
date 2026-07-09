'use strict';
const { create } = require('xmlbuilder2');
const moment = require('moment-timezone');

function generarClave({ pais='506', fecha, cedulaEmisor, consecutivoCompleto, situacion='1' }) {
  // Estructura CORRECTA segun Art.5 DGT-R-48-2016:
  // País(3)+Día(2)+Mes(2)+Año(2)+Cédula(12)+Consecutivo(20)+Situación(1)+CodigoSeguridad(8) = 50
  const d = moment(fecha).tz('America/Costa_Rica');
  const cedula = cedulaEmisor.padStart(12,'0');
  const seg = Math.floor(Math.random()*99999999).toString().padStart(8,'0');
  return `${pais}${d.format('DD')}${d.format('MM')}${d.format('YY')}${cedula}${consecutivoCompleto}${situacion}${seg}`;
}

function generarConsecutivo({ sucursal='001', terminal='00001', tipoDoc='01', numero }) {
  return `${sucursal}${terminal}${tipoDoc}${numero.toString().padStart(10,'0')}`;
}

function calcularTotales(items, tcDolar=500) {
  let totalServGravados=0, totalMercGravadas=0, totalImpuesto=0;
  const lineas = items.map(item => {
    const precioCRC = item.currency==='USD' ? item.price*tcDolar : item.price;
    const subtotal = precioCRC * item.qty;
    const impuesto = subtotal * 0.13;
    const totalLinea = subtotal + impuesto;
    // Servicios vs Mercancias - por defecto mercancias
    totalMercGravadas += subtotal;
    totalImpuesto += impuesto;
    return {
  ...item,
  codigoCABYS: item.codigoCABYS || item.codigoCabys || item.cabys || '',
  precioUnitarioCRC: precioCRC,
  subtotal,
  descuento: 0,
  impuesto,
  impuestoNeto: impuesto,
  totalLinea,
  unidad: 'Unid'
};
  });
  const totalGravado = totalServGravados + totalMercGravadas;
  const totalVenta = totalGravado;
  const totalComprobante = totalVenta + totalImpuesto;
  return { lineas, totalServGravados, totalMercGravadas, totalGravado, totalExento:0, totalImpuesto, totalDescuento:0, totalVenta, totalComprobante };
}

function generarXML(datos) {
  const {
    clave, consecutivo, fecha, emisor, receptor,
    items, totalServGravados=0, totalMercGravadas=0,
    totalGravado, totalExento=0, totalImpuesto,
    totalDescuento=0, totalVenta, totalComprobante,
    condicionVenta='01', medioPago=['01'], tipoDoc='01',
    moneda='CRC', tipoCambio=1,
  } = datos;

  const fechaStr = moment(fecha).tz('America/Costa_Rica').format('YYYY-MM-DDTHH:mm:ss-06:00');
  const ns = tipoDoc==='01'
    ? 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica'
    : 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico';
  const rootName = tipoDoc==='01' ? 'FacturaElectronica' : 'TiqueteElectronico';

  const root = create({ version:'1.0', encoding:'UTF-8' })
    .ele(rootName, {
      xmlns: ns,
      'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation': `${ns} ${ns}.xsd`,
    });

  root.ele('Clave').txt(clave);
  root.ele('ProveedorSistemas').txt('01');
  root.ele('CodigoActividadEmisor').txt(emisor.codigoActividad);
  root.ele('NumeroConsecutivo').txt(consecutivo);
  root.ele('FechaEmision').txt(fechaStr);

  // Emisor
  const em = root.ele('Emisor');
  em.ele('Nombre').txt(emisor.nombre);
  em.ele('Identificacion').ele('Tipo').txt(emisor.tipoId).up().ele('Numero').txt(emisor.cedula);
  if (emisor.nombreComercial) em.ele('NombreComercial').txt(emisor.nombreComercial);
  const ubEm = em.ele('Ubicacion');
  ubEm.ele('Provincia').txt(emisor.provincia||'5');
  ubEm.ele('Canton').txt(emisor.canton||'02');
  ubEm.ele('Distrito').txt(emisor.distrito||'01');
  ubEm.ele('OtrasSenas').txt(emisor.direccion||'Guanacaste, Costa Rica');
  if (emisor.telefono) {
    em.ele('Telefono').ele('CodigoPais').txt('506').up().ele('NumTelefono').txt(emisor.telefono.replace(/\D/g,''));
  }
  em.ele('CorreoElectronico').txt(emisor.correo);

  // Receptor (obligatorio en factura)
  if (receptor && receptor.nombre && tipoDoc==='01') {
    const re = root.ele('Receptor');
    re.ele('Nombre').txt(receptor.nombre);
    if (receptor.cedula) {
      re.ele('Identificacion').ele('Tipo').txt(receptor.tipoId||'01').up().ele('Numero').txt(receptor.cedula);
    }
    if (receptor.correo) re.ele('CorreoElectronico').txt(receptor.correo);
  }

  root.ele('CondicionVenta').txt(condicionVenta);

  // Detalle de servicio
  const detalle = root.ele('DetalleServicio');
  items.forEach((item, i) => {
    const linea = detalle.ele('LineaDetalle');
    linea.ele('NumeroLinea').txt((i+1).toString());
    const cabys = item.codigoCABYS || item.codigoCabys || item.cabys || '3835099010000';
    console.log("ITEM:", JSON.stringify(item, null, 2));
    console.log("CABYS enviado:", cabys);
    linea.ele('CodigoCABYS').txt(cabys);
    linea.ele('Cantidad').txt(item.qty.toFixed(2));
    linea.ele('UnidadMedida').txt(item.unidad||'Unid');
    linea.ele('Detalle').txt(item.name.substring(0,200));
    linea.ele('PrecioUnitario').txt((item.precioUnitarioCRC||item.price||0).toFixed(2));
    linea.ele('MontoTotal').txt(((item.precioUnitarioCRC||item.price||0)*item.qty).toFixed(2));
    linea.ele('SubTotal').txt((item.subtotal||0).toFixed(2));
    linea.ele('BaseImponible').txt((item.subtotal||0).toFixed(2));
    if ((item.impuesto||0) > 0) {
      const imp = linea.ele('Impuesto');
      imp.ele('Codigo').txt('01');
      imp.ele('CodigoTarifaIVA').txt('08');
      imp.ele('Tarifa').txt('13.00');
      imp.ele('Monto').txt((item.impuesto||0).toFixed(2));
    }
    linea.ele('ImpuestoAsumidoEmisorFabrica').txt('0');
    linea.ele('ImpuestoNeto').txt((item.impuesto||0).toFixed(2));
    linea.ele('MontoTotalLinea').txt((item.totalLinea||0).toFixed(2));
  });

  // Resumen
  const res = root.ele('ResumenFactura');
  {
    res.ele('CodigoTipoMoneda').ele('CodigoMoneda').txt(moneda).up().ele('TipoCambio').txt(tipoCambio.toFixed(2));
  }
  res.ele('TotalServGravados').txt('0.00');
  res.ele('TotalServExentos').txt('0');
  res.ele('TotalServExonerado').txt('0');
  res.ele('TotalServNoSujeto').txt('0');
  res.ele('TotalMercanciasGravadas').txt(totalMercGravadas.toFixed(2));
  res.ele('TotalMercanciasExentas').txt('0');
  res.ele('TotalMercExonerada').txt('0');
  res.ele('TotalMercNoSujeta').txt('0');
  res.ele('TotalGravado').txt(totalMercGravadas.toFixed(2));
  res.ele('TotalExento').txt('0');
  res.ele('TotalExonerado').txt('0');
  res.ele('TotalVenta').txt(totalVenta.toFixed(2));
  res.ele('TotalDescuentos').txt(totalDescuento.toFixed(2));
  res.ele('TotalVentaNeta').txt((totalVenta-totalDescuento).toFixed(2));

  // TotalDesgloseImpuesto
  const desglose = res.ele('TotalDesgloseImpuesto');
  desglose.ele('Codigo').txt('01');
  desglose.ele('CodigoTarifaIVA').txt('08');
  desglose.ele('TotalMontoImpuesto').txt(totalImpuesto.toFixed(2));

  res.ele('TotalImpuesto').txt(totalImpuesto.toFixed(2));
  res.ele('TotalImpAsumEmisorFabrica').txt('0');
  res.ele('TotalIVADevuelto').txt('0');

  // MedioPago con nueva estructura v4.4
  const codigosMedio = { '01':'01', '02':'02', '03':'03', '04':'04', '05':'05' };
  medioPago.forEach(mp => {
    const medio = res.ele('MedioPago');
    medio.ele('TipoMedioPago').txt(codigosMedio[mp]||'01');
    medio.ele('TotalMedioPago').txt(totalComprobante.toFixed(2));
  });

  res.ele('TotalComprobante').txt(totalComprobante.toFixed(2));

  return root.end({ prettyPrint:false });
}

module.exports = { generarXML, generarClave, generarConsecutivo, calcularTotales };
