/**
 * Associacao.gs
 * Lógica da aba ASSOCIAÇÃO — a origem dos itens novos.
 *
 * 1. _transformarFio(codigo): reproduz a fórmula (histórica: `TRANSFORMAR_FIO`,
 *    usada como função personalizada na planilha da Bahia) que normaliza um
 *    código cru para até 3 nomes padrão — mais de um quando o código é
 *    composto (ex.: "4085 / COR 987", dois pedidos juntos numa linha só).
 *    Ex.: "4662/PET" → ["4662/1 RECICLADO", "", ""].
 *
 * 2. detectarItensNovos(token): reproduz a coluna H — pega os códigos únicos
 *    da produção (PEDIDO DE FIO, coluna O) que ainda NÃO estão cadastrados na
 *    coluna A da ASSOCIAÇÃO. São os itens novos a cadastrar.
 *
 * 3. registrarItensNovos(token): cadastra automaticamente os itens novos
 *    (código na coluna A, nome[s] nas colunas B/C/D), sem tocar nas fórmulas
 *    já existentes.
 */

/**
 * Normaliza um código de cor para até 3 nomes padrão (colunas B/C/D da
 * ASSOCIAÇÃO — mais de um valor só quando o código é composto). Porta fiel
 * da função `TRANSFORMAR_FIO` (fórmula personalizada já usada na planilha
 * da Bahia) — mantida ramo a ramo igual ao original, sem reescrever a
 * lógica por dentro, para não arriscar divergir do que já foi validado com
 * dados reais.
 * @return {Array<string>} sempre com 3 posições; as que sobram vêm ''.
 */
function _transformarFio(codigo) {
  var a = String(codigo == null ? '' : codigo).trim();
  if (a === '101') return ['101 LAVADO', '', ''];
  if (a === '102') return ['102 LAVADO', '', ''];
  if (a === '2000') return ['2000 LAVADO 30-2', '', ''];

  var au = a.toUpperCase();
  var hasPET      = au.indexOf('/PET') !== -1;
  var hasCOR      = au.indexOf('COR') !== -1;
  var hasB        = /\/B(?!T)/i.test(a);
  var hasCABO     = au.indexOf('CABO') !== -1;
  var has1PET     = au.indexOf('/1PET') !== -1;
  var has1P       = /\/1P/i.test(a);
  var hasPONTEIRA = au.indexOf('PONTEIRA') !== -1;
  var hasPERS     = au.indexOf('PERSONALIZADA') !== -1;
  var hasBT       = au.indexOf('/BT') !== -1;

  function stripZeros(s) {
    s = s.trim();
    return s.replace(/^(0+)(\d)/, '$2');
  }
  function stripZerosFull(p) {
    var match = p.match(/^(\d+)(.*)/);
    if (match) return stripZeros(match[1]) + match[2];
    return p;
  }
  function pad(arr, len) {
    arr = arr.slice();
    while (arr.length < len) arr.push('');
    return arr;
  }

  // ── /1P ── deve vir antes de COR
  if (has1P && !has1PET) {
    var r = a.replace(/\s*\/\s*COR\s*/gi, '|')
             .replace(/\s+\/\s+(?=\d)/gi, '|');
    var sp = r.split('|').map(function (p) { return p.trim(); }).filter(Boolean);
    var primeiroE102 = /^102(\/1P)?$/i.test(sp[0].replace(/\s+TRAMA$/gi, '').trim());
    var mapped = sp.map(function (p, i) {
      var base = p.replace(/\s+TRAMA$/gi, '').trim();
      var baseNum = base.replace(/\/1P$/gi, '').trim();
      var isUltimo = (i === sp.length - 1);
      if (/^102$/i.test(baseNum)) {
        if (isUltimo && primeiroE102) return '481/1P';
        return '102 LAVADO';
      }
      if (isUltimo) return stripZerosFull(baseNum) + '/1P';
      return stripZerosFull(baseNum);
    });
    return pad(mapped, 3);
  }

  // ── COR (múltiplo ou simples) ──
  if (hasCOR) {
    var parts = a.split(/\s*\/\s*COR\s*/i);
    if (parts.length > 1) {
      // /PET + COR + /B
      if (hasPET && hasB && parts.length === 2) {
        var col1 = stripZeros(parts[0].replace(/\/PET/gi, '').replace(/\/$/, '').trim()) + '/1 RECICLADO';
        var col2 = stripZeros(parts[1].replace(/\/B\/PET/gi, '').replace(/\/B/gi, '').trim()) + ' BRILHANTE';
        return pad([col1, col2], 3);
      }
      // /PET + COR
      if (hasPET) {
        var mapped2 = parts.map(function (p, i) {
          var base = stripZeros(p.replace(/\/PET/gi, '').replace(/\/$/, '').trim());
          var out = base + '/1 RECICLADO';
          if (i === 0 && /^101/i.test(p)) out = base + '/1 RECICLADO LAVADO';
          return out;
        });
        return pad(mapped2, 3);
      }
      // COR genérico (sem /PET)
      var result = parts.map(function (p) {
        return stripZeros(p.replace(/\//g, '').trim());
      });
      return pad(result, 3);
    }
  }

  // ── /PET + CABO ──
  if (hasPET && hasCABO) {
    var replaced = a.replace(/\/PET/gi, ' RECICLADO');
    var splitParts = replaced.split('/').map(function (p) {
      return stripZerosFull(p.trim());
    }).filter(Boolean);
    return pad(splitParts, 3);
  }

  // ── /1PET ──
  if (has1PET) {
    return pad([au.replace(/\/1PET/gi, '/1 RECICLADO')], 3);
  }

  // ── /PET (simples ou múltiplos) ──
  if (hasPET) {
    var partsPet = a.split(/\/PET/i);
    var mappedPet = [];
    for (var i = 0; i < partsPet.length; i++) {
      var clean = partsPet[i].trim().replace(/^\/+|\/+$/g, '').trim();
      if (clean !== '') {
        var out2 = stripZeros(clean) + '/1 RECICLADO';
        if (/^101/i.test(clean)) out2 = stripZeros(clean) + '/1 RECICLADO LAVADO';
        mappedPet.push(out2);
      }
    }
    if (mappedPet.length > 0) return pad(mappedPet, 3);
  }

  // ── PONTEIRA ──
  if (hasPONTEIRA) {
    var idx = au.indexOf('PONTEIRA');
    return pad([a.substring(0, idx - 2).trim(), a.substring(idx).trim()], 3);
  }

  // ── PERSONALIZADA ──
  if (hasPERS) {
    var pontIdx = au.indexOf('PONT');
    var persIdx = au.indexOf('PERSONALIZADA');
    return pad([a.substring(0, pontIdx - 1).trim(), a.substring(persIdx).trim()], 3);
  }

  // ── 2XXXX (4 dígitos começando com 2) ──
  if (/^2\d{3}$/.test(a)) {
    return pad([a + ' 30-2'], 3);
  }

  // ── /BT ──
  if (hasBT) {
    return pad([a.replace(/\/BT/gi, '/BT-76/36')], 3);
  }

  // ── /B ──
  if (hasB) {
    var bIdx = au.indexOf('/B');
    var colB1 = a.substring(0, bIdx).trim() + ' BRILHANTE';
    var rest = a.substring(bIdx + 2).replace(/COR/gi, '').replace(/\//g, '').trim();
    return pad([colB1, rest], 3);
  }

  // ── começa com 0 ──
  if (a.charAt(0) === '0') {
    return pad([stripZeros(a)], 3);
  }

  return pad([a], 3);
}

/**
 * Detecta itens novos: códigos da produção (PEDIDO DE FIO, coluna O) que ainda
 * não constam na coluna A da ASSOCIAÇÃO. Somente leitura (não grava).
 * `nomes` vem de `_transformarFio` (até 3 posições, sem as vazias) — mais de
 * um valor quando o código é composto (ex.: duas cores numa linha só).
 * @return {Object} { ok, novos: [{ codigo, nomes }] }
 */
function detectarItensNovos(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);

  // Códigos já cadastrados (coluna A da ASSOCIAÇÃO), normalizados p/ comparação.
  var registrados = {};
  var shA = _aba(CONFIG.SHEETS.ASSOCIACAO);
  if (shA && shA.getLastRow() > 1) {
    shA.getRange(2, 1, shA.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var k = _norm(r[0]);
      if (k) registrados[k] = true;
    });
  }

  // Códigos únicos vistos na produção (PEDIDO DE FIO, coluna O).
  var novos = [];
  var visto = {};
  var shP = _aba(CONFIG.SHEETS.PEDIDO_FIO);
  if (shP && shP.getLastRow() > 1) {
    shP.getRange(1, 15, shP.getLastRow(), 1).getValues().forEach(function (r) { // coluna O
      var cod = r[0];
      var k = _norm(cod);
      if (!k) return;
      if (visto[k] || registrados[k]) return;
      visto[k] = true;
      var nomes = _transformarFio(cod).filter(function (n) { return n !== ''; });
      novos.push({ codigo: String(cod).trim(), nomes: nomes });
    });
  }
  return { ok: true, novos: novos };
}

/**
 * Cadastra automaticamente os itens novos na ASSOCIAÇÃO (coluna A = código,
 * colunas B/C/D = nome[s] padrão — mais de uma só em código composto).
 * Acrescenta ABAIXO da última linha usada em A-D, para nunca sobrescrever
 * fórmulas/dados já existentes.
 *
 * O nome gravado é um PALPITE de `_transformarFio` — pode estar errado se o
 * código usar um padrão que a função ainda não conhece. Por isso devolve
 * também a lista dos itens cadastrados agora (`itens`): a tela de Análise
 * de Compra mostra esses códigos + nome para o master conferir e, se
 * precisar, corrigir na hora com `corrigirAssociacao` — a correção fica
 * valendo para sempre (é a própria aba ASSOCIAÇÃO que "aprende"). Em código
 * composto, só a coluna B (primeiro nome) é editável pela tela por
 * enquanto; os demais aparecem só como referência.
 * @return {Object} { ok, adicionados, itens, mensagem }
 */
function registrarItensNovos(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var novos = detectarItensNovos(token).novos;
  if (!novos.length) {
    return { ok: true, adicionados: 0, itens: [], mensagem: 'Nenhum item novo a cadastrar.' };
  }
  var shA = _aba(CONFIG.SHEETS.ASSOCIACAO);
  var inicio = _ultimaLinhaColunas(shA, [1, 2, 3, 4]) + 1; // após o maior last-row de A-D
  var linhas = novos.map(function (n) {
    return [n.codigo, n.nomes[0] || '', n.nomes[1] || '', n.nomes[2] || ''];
  });
  shA.getRange(inicio, 1, linhas.length, 4).setValues(linhas);
  return {
    ok: true,
    adicionados: novos.length,
    itens: novos.map(function (n) {
      return { codigo: n.codigo, nome: n.nomes[0] || '', extras: n.nomes.slice(1) };
    }),
    mensagem: novos.length + ' item(ns) novo(s) cadastrado(s) na ASSOCIAÇÃO.'
  };
}

/**
 * Corrige o nome padrão (coluna B) de um código já cadastrado na
 * ASSOCIAÇÃO — usado quando o cadastro automático (via `_transformarFio`)
 * saiu errado. A correção é definitiva: da próxima vez que esse código
 * aparecer, `detectarItensNovos` já o considera "conhecido" (está na
 * coluna A) e usa o nome corrigido, sem rodar a fórmula de novo.
 * @return {Object} { ok, mensagem }
 */
function corrigirAssociacao(token, codigo, nome) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  codigo = String(codigo == null ? '' : codigo).trim();
  nome = String(nome == null ? '' : nome).trim();
  if (!codigo) throw new Error('Informe o código.');
  if (!nome) throw new Error('Informe o nome corrigido.');

  var sh = _aba(CONFIG.SHEETS.ASSOCIACAO);
  if (!sh) throw new Error('Aba ASSOCIAÇÃO não encontrada.');
  var last = sh.getLastRow();
  var alvo = _norm(codigo);
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, 1).getValues(); // coluna A
    for (var i = 0; i < vals.length; i++) {
      if (_norm(vals[i][0]) === alvo) {
        sh.getRange(i + 2, 2).setValue(nome); // coluna B, mesma linha
        return { ok: true, mensagem: 'Associação de "' + codigo + '" corrigida para "' + nome + '".' };
      }
    }
  }
  throw new Error('Código "' + codigo + '" não encontrado na ASSOCIAÇÃO.');
}

/** Última linha preenchida considerando um conjunto de colunas (1-indexado). */
function _ultimaLinhaColunas(sh, cols) {
  var maxRows = sh.getMaxRows();
  var ultima = 0;
  cols.forEach(function (c) {
    var vals = sh.getRange(1, c, maxRows, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0]).trim() !== '') { if (i + 1 > ultima) ultima = i + 1; break; }
    }
  });
  return ultima;
}
