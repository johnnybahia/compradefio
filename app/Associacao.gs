/**
 * Associacao.gs
 * Lógica da aba ASSOCIAÇÃO — a origem dos itens novos.
 *
 * 1. _normalizarCor(codigo): reproduz a fórmula da coluna B (código cru →
 *    nome padrão). Ex.: "4662/PET" → "4662/1 RECICLADO". Validado 346/346
 *    contra a planilha real.
 *
 * 2. detectarItensNovos(token): reproduz a coluna H — pega os códigos únicos
 *    da produção (PEDIDO DE FIO, coluna O) que ainda NÃO estão cadastrados na
 *    coluna A da ASSOCIAÇÃO. São os itens novos a cadastrar.
 *
 * 3. registrarItensNovos(token): cadastra automaticamente os itens novos
 *    (acrescenta o código na coluna A e o nome padrão na coluna B), sem tocar
 *    nas fórmulas já existentes.
 */

/**
 * Normaliza um código de cor para o nome padrão (coluna B da ASSOCIAÇÃO).
 * SEARCH é tratado como "contém" (sem diferenciar maiúsc./minúsc.), e as
 * substituições respeitam maiúsculas/minúsculas, como no Sheets.
 */
function _normalizarCor(codigo) {
  var A = String(codigo == null ? '' : codigo).trim();
  if (A === '') return '';
  var up = A.toUpperCase();
  function has(sub) { return up.indexOf(sub.toUpperCase()) !== -1; }
  function pos(sub) { var i = up.indexOf(sub.toUpperCase()); return i < 0 ? -1 : i + 1; }
  function primeiro(v) { return String(v).split('|')[0]; }

  var res;
  if (A === '101') res = '101 LAVADO';
  else if (A === '102') res = '102 LAVADO';
  else if (A === '2000') res = '2000 LAVADO 30-2';
  else if (has('/PET') && has('1 CABO')) {
    // Ex.: "6255/PET 1 CABO" → "6255 RECICLADO 1 CABO" (o fio de 1 cabo não
    // leva o prefixo "/1"; é um produto diferente do "/PET" 2 cabos comum).
    res = A.replace(/\/PET\s*/i, ' RECICLADO ').replace(/\s+/g, ' ').trim();
  } else if (has('/PET') && has('COR')) {
    res = primeiro(A.replace(/\/PET/g, '/1 RECICLADO').replace(/ \/ COR /g, '|').replace(/COR/g, ''));
  } else if (has('/PET')) {
    res = A.replace(/\/PET/g, '/1 RECICLADO');
  } else if (has('/1PET')) {
    res = A.toUpperCase().replace(/\/1PET/g, '/1 RECICLADO');
  } else if (has('PONTEIRA')) {
    res = A.substring(0, pos('PONTEIRA') - 5).trim();
  } else if (has('PERSONALIZADA')) {
    res = A.substring(0, pos('PONT') - 2).trim();
  } else if (A.charAt(0) === '2' && A.length === 4) {
    res = A + ' 30-2';
  } else if (has('/BT')) {
    // Ex.: "6180/BT" → "6180/BT-76/36" (fio BT, tem receita própria em
    // BASE TINGIMENTO). Precisa vir antes de "/B" (que também bateria aqui).
    res = A.replace(/\/BT/gi, '/BT-76/36');
  } else if (has('/B') && has('COR')) {
    res = A.substring(0, pos('/B') - 1).trim() + ' BRILHANTE';
  } else if (has('COR')) {
    res = A.replace(/COR/g, '').replace(/\//g, '').split(' ')[0];
  } else if (has('/B')) {
    res = A.substring(0, pos('/B') - 1).trim() + ' BRILHANTE';
  } else if (A.charAt(0) === '0') {
    res = A.replace(/^0+/, '');
  } else {
    res = A;
  }
  // Coerção de zeros à esquerda em resultado puramente numérico (como o Sheets faz).
  if (/^\d+$/.test(res)) res = String(parseInt(res, 10));
  return res;
}

/**
 * Detecta itens novos: códigos da produção (PEDIDO DE FIO, coluna O) que ainda
 * não constam na coluna A da ASSOCIAÇÃO. Somente leitura (não grava).
 * @return {Object} { ok, novos: [{ codigo, nome }] }
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
      novos.push({ codigo: String(cod).trim(), nome: _normalizarCor(cod) });
    });
  }
  return { ok: true, novos: novos };
}

/**
 * Cadastra automaticamente os itens novos na ASSOCIAÇÃO (coluna A = código,
 * coluna B = nome padrão). Acrescenta ABAIXO da última linha usada em A e B,
 * para nunca sobrescrever fórmulas existentes.
 *
 * O nome gravado é um PALPITE de `_normalizarCor` — pode estar errado se o
 * código usar um padrão que a função ainda não conhece. Por isso devolve
 * também a lista dos itens cadastrados agora (`itens`): a tela de Análise
 * de Compra mostra esses códigos + nome para o master conferir e, se
 * precisar, corrigir na hora com `corrigirAssociacao` — a correção fica
 * valendo para sempre (é a própria aba ASSOCIAÇÃO que "aprende").
 * @return {Object} { ok, adicionados, itens, mensagem }
 */
function registrarItensNovos(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var novos = detectarItensNovos(token).novos;
  if (!novos.length) {
    return { ok: true, adicionados: 0, itens: [], mensagem: 'Nenhum item novo a cadastrar.' };
  }
  var shA = _aba(CONFIG.SHEETS.ASSOCIACAO);
  var inicio = _ultimaLinhaColunas(shA, [1, 2]) + 1; // após o maior last-row de A e B
  var linhas = novos.map(function (n) { return [n.codigo, n.nome]; });
  shA.getRange(inicio, 1, linhas.length, 2).setValues(linhas);
  return {
    ok: true,
    adicionados: novos.length,
    itens: novos,
    mensagem: novos.length + ' item(ns) novo(s) cadastrado(s) na ASSOCIAÇÃO.'
  };
}

/**
 * Corrige o nome padrão (coluna B) de um código já cadastrado na
 * ASSOCIAÇÃO — usado quando o cadastro automático (via `_normalizarCor`)
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
