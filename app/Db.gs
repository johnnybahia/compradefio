/**
 * Db.gs
 * Camada de acesso à planilha (banco de dados). Concentra a leitura e a
 * escrita para que o resto do sistema não conheça a estrutura física.
 */

/**
 * ID da unidade ativa nesta execução (ex.: 'CEARA', 'BAHIA'), definido por
 * `exigirSessao`/`login` a partir do token. Cada chamada ao Web App é uma
 * execução isolada do Apps Script — esta variável nasce `null` a cada
 * chamada, então não vaza entre usuários/unidades diferentes.
 */
var _unidadeAtivaId = null;

/** Define a unidade ativa para o restante desta execução (ver `_ss`). */
function _definirUnidadeAtiva(id) {
  _unidadeAtivaId = id || null;
}

/**
 * Abre a planilha-banco de dados. Sem argumento, usa a unidade ativa da
 * sessão (ou a padrão, se nenhuma foi definida ainda). Passe um ID explícito
 * para abrir uma planilha fixa independente da unidade (ex.: a aba USUARIOS,
 * que é global e não muda por unidade — ver `_ssAutenticacao` em Auth.gs).
 */
function _ss(idOpcional) {
  return SpreadsheetApp.openById(idOpcional || CONFIG.getSpreadsheetId(_unidadeAtivaId));
}

/**
 * Retorna a aba pelo nome. Se ela não existir e `headers` for informado,
 * cria a aba com o cabeçalho. `ssOpcional` permite operar numa planilha
 * específica em vez da unidade ativa (ver `_ss`).
 */
function _aba(nome, headers, ssOpcional) {
  var ss = ssOpcional || _ss();
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
function lerRegistros(nome, ssOpcional) {
  var sh = _aba(nome, null, ssOpcional);
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
function acrescentarRegistro(nome, obj, headersPadrao, ssOpcional) {
  var sh = _aba(nome, headersPadrao || Object.keys(obj), ssOpcional);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var linha = headers.map(function (h) {
    return obj.hasOwnProperty(h) ? obj[h] : '';
  });
  sh.appendRow(linha);
  return sh.getLastRow();
}

/**
 * Acha o índice de uma coluna dentro de um cabeçalho já normalizado (via
 * `_norm`), tentando cada nome de `nomes` em ordem. Devolve -1 se nenhum
 * bater. Existe para aceitar mais de uma convenção de nome de coluna na
 * mesma aba lógica — ex.: a aba ESTOQUE tem cabeçalho "Item/Data/Saldo" no
 * Ceará, mas "Descrição/Data Lançamento/Saldo de Estoque" na Bahia (mesmo
 * dado, planilha herdada de outro script).
 */
function _colPorNomes(headerNormalizado, nomes) {
  for (var i = 0; i < nomes.length; i++) {
    var idx = headerNormalizado.indexOf(nomes[i]);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Atualiza uma célula específica (por número de linha e nome de coluna).
 */
function atualizarCelula(nome, numeroLinha, coluna, valor, ssOpcional) {
  var sh = _aba(nome, null, ssOpcional);
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
