function TRANSFORMAR_FIO(valor) {
  var a = String(valor).trim();

  if (a === "101") return [["101 LAVADO", "", ""]];
  if (a === "102") return [["102 LAVADO", "", ""]];
  if (a === "2000") return [["2000 LAVADO 30-2", "", ""]];

  var au = a.toUpperCase();
  var hasPET      = au.indexOf("/PET") !== -1;
  var hasCOR      = au.indexOf("COR") !== -1;
  var hasB        = /\/B(?!T)/i.test(a);
  var hasCABO     = au.indexOf("CABO") !== -1;
  var has1PET     = au.indexOf("/1PET") !== -1;
  var has1P       = /\/1P/i.test(a);
  var hasPONTEIRA = au.indexOf("PONTEIRA") !== -1;
  var hasPERS     = au.indexOf("PERSONALIZADA") !== -1;
  var hasBT       = au.indexOf("/BT") !== -1;

  function stripZeros(s) {
    s = s.trim();
    return s.replace(/^(0+)(\d)/, "$2");
  }

  function stripZerosFull(p) {
    var match = p.match(/^(\d+)(.*)/);
    if (match) {
      return stripZeros(match[1]) + match[2];
    }
    return p;
  }

  function pad(arr, len) {
    while (arr.length < len) arr.push("");
    return arr;
  }

  // ── /1P ── deve vir antes de COR
  if (has1P && !has1PET) {
    var r = a.replace(/\s*\/\s*COR\s*/gi, "|")
             .replace(/\s+\/\s+(?=\d)/gi, "|");

    var sp = r.split("|").map(function(p) { return p.trim(); }).filter(Boolean);

    var primeiroE102 = /^102(\/1P)?$/i.test(sp[0].replace(/\s+TRAMA$/gi, "").trim());

    var mapped = sp.map(function(p, i) {
      var base = p.replace(/\s+TRAMA$/gi, "").trim();
      var baseNum = base.replace(/\/1P$/gi, "").trim();
      var isUltimo = (i === sp.length - 1);

      if (/^102$/i.test(baseNum)) {
        if (isUltimo && primeiroE102) return "481/1P";
        return "102 LAVADO";
      }

      if (isUltimo) {
        return stripZerosFull(baseNum) + "/1P";
      }

      return stripZerosFull(baseNum);
    });

    return [pad(mapped, 3)];
  }

  // ── COR (multi ou simples) ──
  if (hasCOR) {
    var parts = a.split(/\s*\/\s*COR\s*/i);
    if (parts.length > 1) {

      // /PET + COR + /B
      if (hasPET && hasB && parts.length === 2) {
        var col1 = stripZeros(parts[0].replace(/\/PET/gi, "").replace(/\/$/, "").trim()) + "/1 RECICLADO";
        var col2 = stripZeros(parts[1].replace(/\/B\/PET/gi, "").replace(/\/B/gi, "").trim()) + " BRILHANTE";
        return [pad([col1, col2], 3)];
      }

      // /PET + COR
      if (hasPET) {
        var mapped = parts.map(function(p, i) {
          var base = stripZeros(p.replace(/\/PET/gi, "").replace(/\/$/, "").trim());
          var out = base + "/1 RECICLADO";
          if (i === 0 && /^101/i.test(p)) out = base + "/1 RECICLADO LAVADO";
          return out;
        });
        return [pad(mapped, 3)];
      }

      // COR genérico (sem /PET)
      var result = parts.map(function(p) {
        return stripZeros(p.replace(/\//g, "").trim());
      });
      return [pad(result, 3)];
    }
  }

  // ── /PET + CABO ──
  if (hasPET && hasCABO) {
    var replaced = a.replace(/\/PET/gi, " RECICLADO");
    var splitParts = replaced.split("/").map(function(p) {
      return stripZerosFull(p.trim());
    }).filter(Boolean);

    return [pad(splitParts, 3)];
  }

  // ── /1PET ──
  if (has1PET) {
    return [pad([au.replace(/\/1PET/gi, "/1 RECICLADO")], 3)];
  }

  // ── /PET (Simples ou Múltiplos) ──
  if (hasPET) {
    var parts = a.split(/\/PET/i);
    var mapped = [];
    
    for (var i = 0; i < parts.length; i++) {
      var clean = parts[i].trim().replace(/^\/+|\/+$/g, "").trim();
      
      if (clean !== "") {
        var out = stripZeros(clean) + "/1 RECICLADO";
        if (/^101/i.test(clean)) {
          out = stripZeros(clean) + "/1 RECICLADO LAVADO";
        }
        mapped.push(out);
      }
    }
    
    if (mapped.length > 0) {
      return [pad(mapped, 3)];
    }
  }

  // ── PONTEIRA ──
  if (hasPONTEIRA) {
    var idx = au.indexOf("PONTEIRA");
    return [pad([a.substring(0, idx - 2).trim(), a.substring(idx).trim()], 3)];
  }

  // ── PERSONALIZADA ──
  if (hasPERS) {
    var pontIdx = au.indexOf("PONT");
    var persIdx = au.indexOf("PERSONALIZADA");
    return [pad([a.substring(0, pontIdx - 1).trim(), a.substring(persIdx).trim()], 3)];
  }

  // ── 2XXXX (4 dígitos começando com 2) ──
  if (/^2\d{3}$/.test(a)) {
    return [pad([a + " 30-2"], 3)];
  }

  // ── /BT ──
  if (hasBT) {
    return [pad([a.replace(/\/BT/gi, "/BT-76/36")], 3)];
  }

  // ── /B ──
  if (hasB) {
    var bIdx = au.indexOf("/B");
    var col1 = a.substring(0, bIdx).trim() + " BRILHANTE";
    var rest = a.substring(bIdx + 2).replace(/COR/gi, "").replace(/\//g, "").trim();
    return [pad([col1, rest], 3)];
  }

  // ── começa com 0 ──
  if (a.charAt(0) === "0") {
    return [pad([stripZeros(a)], 3)];
  }

  return [pad([a], 3)];
}
