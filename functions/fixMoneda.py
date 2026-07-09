with open('/home/marcojc85/posil-fe/functions/xmlBuilder.js', 'r') as f:
    c = f.read()

# Fix CodigoTipoMoneda - always include it
old = """  if (moneda !== 'CRC') {
    res.ele('CodigoTipoMoneda').ele('CodigoMoneda').txt(moneda).up().ele('TipoCambio').txt(tipoCambio.toFixed(2));
  }"""
new = "  res.ele('CodigoTipoMoneda').ele('CodigoMoneda').txt(moneda||'CRC').up().ele('TipoCambio').txt((tipoCambio||1).toFixed(2));"
c = c.replace(old, new)

# Also remove the extra closing brace if it was added
c = c.replace("  }\n  res.ele('TotalServGravados')", "  res.ele('TotalServGravados')")

print('Fixed:', 'CodigoTipoMoneda' in c)
with open('/home/marcojc85/posil-fe/functions/xmlBuilder.js', 'w') as f:
    f.write(c)
