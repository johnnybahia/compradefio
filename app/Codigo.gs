/**
 * Codigo.gs
 * Ponto de entrada do Web App e utilitários de template.
 */

/** Servido quando o usuário abre a URL do Web App. */
function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.LOGO = _logoDataUri();
  t.APP_NOME = CONFIG.APP_NOME;
  return t.evaluate()
    .setTitle(CONFIG.APP_NOME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .setFaviconUrl('https://ssl.gstatic.com/docs/script/images/favicon.png');
}

/**
 * Monta o data URI do logo a partir do arquivo Logo (base64). Se o conteúdo
 * vier misturado com HTML (colagem no editor) ou vazio, devolve string vazia
 * em vez de um src inválido — o logo é opcional e nunca deve quebrar a página.
 */
function _logoDataUri() {
  try {
    var bruto = HtmlService.createHtmlOutputFromFile('Logo').getContent();
    var b64 = bruto.replace(/\s+/g, '');
    // Se sobrou marcação HTML, o arquivo foi colado errado — não usa.
    if (!b64 || /[<>]/.test(b64)) return '';
    return 'data:image/png;base64,' + b64;
  } catch (e) {
    return '';
  }
}

/** Permite incluir um arquivo HTML dentro de outro via <?!= include('Nome') ?>. */
function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

/**
 * Informações do sistema para a interface (nome do app, papéis, rótulos).
 * Não exige sessão — apenas dados estáticos usados para montar a tela.
 */
function infoApp() {
  return {
    nome: CONFIG.APP_NOME,
    papeis: CONFIG.PAPEIS,
    rotulos: CONFIG.PAPEIS_ROTULO
  };
}

/**
 * Diagnóstico de configuração. Rode pelo editor (Executar → diagnostico) e
 * veja o registro de execução para conferir se está tudo no lugar.
 */
function diagnostico() {
  var linhas = [];
  try {
    var id = CONFIG.getSpreadsheetId();
    linhas.push('✓ SPREADSHEET_ID definido: ' + id);
    var ss = SpreadsheetApp.openById(id);
    linhas.push('✓ Planilha aberta: "' + ss.getName() + '"');
    var abas = ss.getSheets().map(function (s) { return s.getName(); });
    linhas.push('  Abas encontradas: ' + abas.join(', '));
    var usuarios = ss.getSheetByName(CONFIG.SHEETS.USUARIOS);
    if (usuarios) {
      linhas.push('✓ Aba USUARIOS existe (' + (usuarios.getLastRow() - 1) + ' usuário[s]).');
    } else {
      linhas.push('✗ Aba USUARIOS NÃO existe → rode inicializarSistema.');
    }
  } catch (e) {
    linhas.push('✗ ERRO: ' + e.message);
  }
  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}
