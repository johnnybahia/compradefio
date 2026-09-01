/**
 * Codigo.gs
 * Ponto de entrada do Web App e utilitários de template.
 */

/** Servido quando o usuário abre a URL do Web App. */
function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.LOGO_URL = CONFIG.LOGO_URL;
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
 * Envio de e-mail do sistema, centralizado (Pedido de Fio, urgência,
 * confirmação/cancelamento de embarque — ver chamadas em Consultas.gs e
 * Embarque.gs). O endereço remetente é sempre o da conta que fez o deploy
 * do Web App (`executeAs: USER_DEPLOYING`, ver appsscript.json); só o nome
 * de exibição é customizado (`CONFIG.NOME_REMETENTE_EMAIL`).
 * @param {Object} opcoes { to, subject, htmlBody, attachments }
 */
function _enviarEmailSistema(opcoes) {
  MailApp.sendEmail({
    to: opcoes.to,
    subject: opcoes.subject,
    htmlBody: opcoes.htmlBody,
    name: CONFIG.NOME_REMETENTE_EMAIL,
    attachments: opcoes.attachments || []
  });
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
  CONFIG.UNIDADES.forEach(function (u) {
    linhas.push('--- Unidade ' + u.rotulo + ' (' + u.id + ') ---');
    try {
      var id = CONFIG.getSpreadsheetId(u.id);
      linhas.push('✓ Planilha configurada (' + u.propSpreadsheet + ' ou SPREADSHEET_ID): ' + id);
      var ss = SpreadsheetApp.openById(id);
      linhas.push('✓ Planilha aberta: "' + ss.getName() + '"');
      var abas = ss.getSheets().map(function (s) { return s.getName(); });
      linhas.push('  Abas encontradas: ' + abas.join(', '));
    } catch (e) {
      linhas.push('✗ ERRO: ' + e.message);
    }
  });
  try {
    var ssAuth = _ssAutenticacao();
    linhas.push('--- Autenticação (aba USUARIOS, global) ---');
    linhas.push('✓ Planilha de autenticação: "' + ssAuth.getName() + '"');
    var usuarios = ssAuth.getSheetByName(CONFIG.SHEETS.USUARIOS);
    if (usuarios) {
      linhas.push('✓ Aba USUARIOS existe (' + (usuarios.getLastRow() - 1) + ' usuário[s]).');
    } else {
      linhas.push('✗ Aba USUARIOS NÃO existe → rode inicializarSistema.');
    }
  } catch (e) {
    linhas.push('✗ ERRO (autenticação): ' + e.message);
  }

  linhas.push('--- Logo ---');
  linhas.push('URL fixa (CONFIG.LOGO_URL): ' + CONFIG.LOGO_URL +
    ' — sem arquivo/Drive envolvido; se o link cair, a tag <img> só se oculta (onerror).');

  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}

/**
 * Dispara um e-mail de teste (mesmo modelo da urgência de Tingimento) só
 * para o endereço configurado na Propriedade do Script `EMAIL_TESTE` — não
 * mexe em PENDENCIA_COMPRA nem usa a lista real de destinatários
 * (EMAILS_COMPRA). Rode pelo editor (Executar → testarEnvioUrgencia) pra
 * confirmar, sem afetar produção, que o e-mail sai certo depois de trocar a
 * conta que executa o Web App (ver NOME_REMETENTE_EMAIL em Config.gs).
 * Configure antes: Configurações do projeto → Propriedades do script →
 * EMAIL_TESTE = endereço que deve receber o teste (ex.: o do master).
 */
function testarEnvioUrgencia() {
  var emailTeste = PropertiesService.getScriptProperties().getProperty('EMAIL_TESTE');
  if (!emailTeste) {
    throw new Error(
      'Configure a Propriedade do Script EMAIL_TESTE (Configurações do projeto → ' +
      'Propriedades do script) com o e-mail que deve receber o teste.'
    );
  }
  var dataFmt = Utilities.formatDate(new Date(), 'America/Fortaleza', 'dd/MM/yyyy HH:mm');
  var detalhesTeste = [{
    item: 'TESTE-000', descricao: 'Item fictício — só para testar o envio de e-mail',
    cliente: '(teste)', dataUrgencia: '', qtdUrgencia: ''
  }];
  _enviarEmailSistema({
    to: emailTeste,
    subject: '[TESTE] Disparo de urgência — Tingimento',
    htmlBody: _urgenciaTingimentoHTML(
      detalhesTeste, CONFIG.getUnidadeInfo().rotulo.toUpperCase(), 'teste', dataFmt
    )
  });
  Logger.log('E-mail de teste enviado para ' + emailTeste + '.');
  return { ok: true, enviadoPara: emailTeste };
}
