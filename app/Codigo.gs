/**
 * Codigo.gs
 * Ponto de entrada do Web App e utilitários de template.
 */

/** Servido quando o usuário abre a URL do Web App. */
function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.LOGO = 'data:image/png;base64,' +
    HtmlService.createHtmlOutputFromFile('Logo').getContent().replace(/\s+/g, '');
  t.APP_NOME = CONFIG.APP_NOME;
  return t.evaluate()
    .setTitle(CONFIG.APP_NOME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .setFaviconUrl('https://ssl.gstatic.com/docs/script/images/favicon.png');
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
