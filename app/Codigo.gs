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
 * Qualquer motivo de falha fica registrado no log de execução (Executar →
 * Registros/Logs), para diagnosticar sem precisar mexer no código.
 */
function _logoDataUri() {
  try {
    var bruto = HtmlService.createHtmlOutputFromFile('Logo').getContent();
    var b64 = bruto.replace(/\s+/g, '');
    if (!b64) {
      Logger.log('_logoDataUri: o arquivo "Logo" existe mas está vazio.');
      return '';
    }
    // Se sobrou marcação HTML, o arquivo foi colado errado — não usa.
    if (/[<>]/.test(b64)) {
      Logger.log('_logoDataUri: o arquivo "Logo" tem "<" ou ">" no conteúdo — ' +
        'parece que foi colado com marcação HTML por engano (deveria ter só o ' +
        'texto em base64, sem nenhuma tag).');
      return '';
    }
    // Confere se o texto realmente decodifica para um PNG (assinatura dos 8
    // primeiros bytes) — sem isso, o texto pode "parecer" base64 válido e
    // mesmo assim não virar uma imagem de verdade (arquivo truncado/trocado).
    var bytes;
    try {
      bytes = Utilities.base64Decode(b64);
    } catch (e2) {
      Logger.log('_logoDataUri: o conteúdo do arquivo "Logo" não é um base64 válido — ' + e2.message);
      return '';
    }
    var assinaturaPng = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    var assinaturaOk = bytes.length > 8;
    for (var i = 0; assinaturaOk && i < 8; i++) {
      if (bytes[i] !== assinaturaPng[i]) assinaturaOk = false;
    }
    if (!assinaturaOk) {
      Logger.log('_logoDataUri: o arquivo "Logo" decodifica, mas os bytes (' + bytes.length +
        ') não têm a assinatura de um PNG — o arquivo pode estar truncado, corrompido, ou não ' +
        'ser realmente um PNG (ex.: foi salvo como JPEG mas o código está montando ' +
        'como "data:image/png").');
      return '';
    }
    return 'data:image/png;base64,' + b64;
  } catch (e) {
    Logger.log('_logoDataUri: não encontrei/consegui ler o arquivo "Logo" no projeto — ' + e.message);
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

  var logo = _logoDataUri();
  if (logo) {
    linhas.push('✓ Logo OK (arquivo "Logo" lido e decodificado, ' +
      Math.round(logo.length * 3 / 4 / 1024) + ' KB aprox.).');
  } else {
    linhas.push('✗ Logo NÃO carregou — veja o motivo exato acima nesta mesma execução ' +
      '(mensagem "_logoDataUri: ..."), ou confira se: (1) existe um arquivo chamado ' +
      '"Logo" no projeto (Executar → Ver arquivos do projeto); (2) o conteúdo dele é ' +
      'só o texto em base64 do PNG, sem nenhuma tag HTML; (3) depois de corrigir, foi ' +
      'publicada uma NOVA implantação (Implantar → Gerenciar implantações → editar → ' +
      'Nova versão) — a implantação antiga continua servindo o código de quando foi criada.');
  }

  var texto = linhas.join('\n');
  Logger.log(texto);
  return texto;
}
