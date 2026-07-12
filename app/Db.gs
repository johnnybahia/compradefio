/**
 * Db.gs
 * Camada de acesso à planilha (banco de dados). Concentra a leitura e a
 * escrita para que o resto do sistema não conheça a estrutura física.
 */

/** Abre a planilha-banco de dados. */
function _ss() {
  return SpreadsheetApp.openById(CONFIG.getSpreadsheetId());
}

/**
 * Retorna a aba pelo nome. Se ela não existir e `headers` for informado,
 * cria a aba com o cabeçalho.
 */
function _aba(nome, headers) {
  var ss = _ss();
  var sh = ss.getSheetByName(nome);
  if (!sh && headers && headers.length) {
    sh = ss.insertSheet(nome);
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#0F5FA0')
      .setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Lê uma aba inteira como lista de objetos { CABEÇALHO: valor }.
 * Cada objeto recebe `__row` com o número da linha na planilha (para updates).
 */
function lerRegistros(nome) {
  var sh = _aba(nome);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var largura = sh.getLastColumn();
  var valores = sh.getRange(1, 1, last, largura).getValues();
  var headers = valores.shift().map(function (h) { return String(h).trim(); });
  return valores.map(function (linha, i) {
    var obj = {};
    headers.forEach(function (h, c) { obj[h] = linha[c]; });
    obj.__row = i + 2; // +1 pelo cabeçalho, +1 porque linhas começam em 1
    return obj;
  });
}

/**
 * Acrescenta uma linha ao final de uma aba, respeitando a ordem do cabeçalho.
 * `obj` é um objeto { CABEÇALHO: valor }. Cria a aba se necessário (usando as
 * chaves de `obj` como cabeçalho, quando `headersPadrao` não for informado).
 */
function acrescentarRegistro(nome, obj, headersPadrao) {
  var sh = _aba(nome, headersPadrao || Object.keys(obj));
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var linha = headers.map(function (h) {
    return obj.hasOwnProperty(h) ? obj[h] : '';
  });
  sh.appendRow(linha);
  return sh.getLastRow();
}

/**
 * Atualiza uma célula específica (por número de linha e nome de coluna).
 */
function atualizarCelula(nome, numeroLinha, coluna, valor) {
  var sh = _aba(nome);
  if (!sh) throw new Error('Aba não encontrada: ' + nome);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var idx = headers.indexOf(coluna);
  if (idx === -1) throw new Error('Coluna não encontrada: ' + coluna + ' em ' + nome);
  sh.getRange(numeroLinha, idx + 1).setValue(valor);
}

/**
 * Substitui todo o conteúdo (exceto cabeçalho) de uma aba por novas linhas.
 * `linhas` é uma matriz de arrays já na ordem do cabeçalho.
 */
function reescreverAba(nome, headers, linhas) {
  var sh = _aba(nome, headers);
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  }
  if (linhas && linhas.length) {
    sh.getRange(2, 1, linhas.length, headers.length).setValues(linhas);
  }
  return sh;
}
