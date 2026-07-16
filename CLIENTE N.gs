function BUSCAR_PEDIDO_N(intervalo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const assoc = ss.getSheetByName("ASSOCIAÇÃO");
  const pedido = ss.getSheetByName("PEDIDO DE FIO");

  const assocData = assoc.getRange("A2:E" + assoc.getLastRow()).getValues();
  const pedidoData = pedido.getRange("N7:O" + pedido.getLastRow()).getValues();

  const mapaPedido = {};
  pedidoData.forEach(row => {
    if (String(row[1]).trim() !== "")
      mapaPedido[String(row[1]).trim().toUpperCase()] = String(row[0]).trim();
  });

  const vals = Array.isArray(intervalo) ? intervalo.flat() : [intervalo];

  return vals.map(val => {
    if (!val || val === "") return [""];

    const transformado = TRANSFORMAR_FIO(val);
    const partes = transformado[0].filter(p => p !== "");

    for (const parte of partes) {
      const parteNorm = parte.trim().replace(/\u00A0/g, "").replace(/\s+/g, " ").toUpperCase();
      const candidatos = [];

      assocData.forEach(row => {
        const a = String(row[0]).trim().toUpperCase();
        for (let col = 1; col <= 4; col++) {
          const cell = String(row[col]).trim().replace(/\u00A0/g, "").replace(/\s+/g, " ").toUpperCase();
          if (cell === parteNorm) {
            if (a && !candidatos.includes(a)) candidatos.push(a);
            break;
          }
        }
      });

      for (const cod of candidatos) {
        if (mapaPedido[cod] !== undefined) return [mapaPedido[cod]];
      }
    }

    return ["Sem cadastro"];
  });
}
