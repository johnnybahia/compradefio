/**
 * Auth.gs
 * Autenticação própria (usuário/senha), independente de conta Google.
 *
 * - Senhas: nunca são armazenadas em texto. Guardamos um salt aleatório por
 *   usuário e o hash SHA-256 iterado (salt + senha).
 * - Sessão: token assinado (HMAC-SHA256) e sem estado no servidor. O token
 *   carrega usuário, papel e validade; a assinatura impede adulteração.
 *
 * Estrutura da aba USUARIOS:
 *   USUARIO | NOME | PAPEL | SALT | SENHA_HASH | ATIVO
 */

var USUARIOS_HEADERS = ['USUARIO', 'NOME', 'PAPEL', 'SALT', 'SENHA_HASH', 'ATIVO'];
var HASH_ITERACOES = 1000;

/**
 * A aba USUARIOS é global (as mesmas credenciais servem para todas as
 * unidades) — por isso mora sempre na mesma planilha, independente de qual
 * unidade está ativa no momento. Por padrão usa a planilha da unidade
 * padrão (CONFIG.UNIDADE_PADRAO); defina SPREADSHEET_ID_AUTH nas
 * Propriedades do script para guardar os usuários num lugar à parte.
 */
function _ssAutenticacao() {
  var idFixo = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID_AUTH');
  return _ss(idFixo || CONFIG.getSpreadsheetId(CONFIG.UNIDADE_PADRAO));
}

/* ---------------------------- Hash de senha ---------------------------- */

function _bytesParaHex(bytes) {
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function _gerarSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

function _hashSenha(senha, salt) {
  var atual = salt + '|' + senha;
  for (var i = 0; i < HASH_ITERACOES; i++) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, atual, Utilities.Charset.UTF_8);
    atual = _bytesParaHex(bytes);
  }
  return atual;
}

/* ------------------------------- Token --------------------------------- */

function _segredoToken() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function _assinar(texto) {
  var bytes = Utilities.computeHmacSha256Signature(texto, _segredoToken());
  return Utilities.base64EncodeWebSafe(bytes);
}

function _criarToken(usuario, papel, unidade) {
  var payload = {
    u: usuario,
    p: papel,
    un: unidade || CONFIG.UNIDADE_PADRAO,
    exp: Date.now() + CONFIG.SESSAO_HORAS * 3600 * 1000
  };
  var corpo = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return corpo + '.' + _assinar(corpo);
}

/**
 * Valida o token e devolve { usuario, papel, unidade } ou null se
 * inválido/expirado.
 */
function _validarToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  var partes = token.split('.');
  var corpo = partes[0];
  var assinatura = partes[1];
  if (_assinar(corpo) !== assinatura) return null;
  try {
    var payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(corpo)).getDataAsString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return { usuario: payload.u, papel: payload.p, unidade: payload.un || CONFIG.UNIDADE_PADRAO };
  } catch (e) {
    return null;
  }
}

/* --------------------------- API de sessão ----------------------------- */

/**
 * Faz login. Retorna { ok, token, nome, papel } ou { ok:false, erro }.
 * Exposta ao cliente via google.script.run.
 */
function login(usuario, senha) {
  usuario = (usuario || '').toString().trim().toLowerCase();
  senha = (senha || '').toString();
  if (!usuario || !senha) return { ok: false, erro: 'Informe usuário e senha.' };

  var registros = lerRegistros(CONFIG.SHEETS.USUARIOS, _ssAutenticacao());
  var u = registros.filter(function (r) {
    return String(r.USUARIO).trim().toLowerCase() === usuario;
  })[0];

  if (!u) return { ok: false, erro: 'Usuário ou senha inválidos.' };
  if (String(u.ATIVO).trim().toUpperCase() === 'NÃO' ||
      String(u.ATIVO).trim().toUpperCase() === 'NAO' ||
      u.ATIVO === false) {
    return { ok: false, erro: 'Usuário desativado. Fale com o administrador.' };
  }
  if (_hashSenha(senha, String(u.SALT)) !== String(u.SENHA_HASH)) {
    return { ok: false, erro: 'Usuário ou senha inválidos.' };
  }

  var unidade = CONFIG.UNIDADE_PADRAO;
  return {
    ok: true,
    token: _criarToken(usuario, String(u.PAPEL).trim(), unidade),
    nome: String(u.NOME || u.USUARIO),
    papel: String(u.PAPEL).trim(),
    unidade: CONFIG.getUnidadeInfo(unidade),
    unidades: CONFIG.UNIDADES
  };
}

/**
 * Revalida um token existente (usado quando o usuário recarrega a página).
 * Retorna { ok, nome, papel, unidade, unidades } ou { ok:false }.
 */
function validarSessao(token) {
  var s = _validarToken(token);
  if (!s) return { ok: false };
  var registros = lerRegistros(CONFIG.SHEETS.USUARIOS, _ssAutenticacao());
  var u = registros.filter(function (r) {
    return String(r.USUARIO).trim().toLowerCase() === s.usuario;
  })[0];
  if (!u || u.ATIVO === false) return { ok: false };
  return {
    ok: true,
    nome: String(u.NOME || u.USUARIO),
    papel: String(u.PAPEL).trim(),
    unidade: CONFIG.getUnidadeInfo(s.unidade),
    unidades: CONFIG.UNIDADES
  };
}

/**
 * Garante, no servidor, que a requisição tem token válido e (opcionalmente)
 * um dos papéis permitidos. Retorna { usuario, papel, unidade } ou lança
 * erro. Toda função de dados deve chamar isto antes de ler/gravar — de
 * quebra, ela também ativa a unidade da sessão (`_definirUnidadeAtiva`)
 * para que as próximas leituras/gravações desta mesma chamada usem a
 * planilha certa.
 */
function exigirSessao(token, papeisPermitidos) {
  var s = _validarToken(token);
  if (!s) throw new Error('Sessão expirada. Faça login novamente.');
  if (papeisPermitidos && papeisPermitidos.length &&
      papeisPermitidos.indexOf(s.papel) === -1 && s.papel !== CONFIG.PAPEIS.MASTER) {
    throw new Error('Você não tem permissão para esta ação.');
  }
  _definirUnidadeAtiva(s.unidade);
  return s;
}

/**
 * Lista as unidades configuradas no sistema, para o seletor da interface.
 */
function listarUnidades(token) {
  var s = exigirSessao(token);
  return { ok: true, unidades: CONFIG.UNIDADES, atual: s.unidade };
}

/**
 * Troca a unidade ativa da sessão (o "banco de dados" que as próximas
 * chamadas vão usar) e devolve um token novo já com a unidade nova —
 * o cliente troca o token guardado e recarrega a tela atual.
 */
function trocarUnidade(token, unidadeId) {
  var s = exigirSessao(token);
  var u = CONFIG.getUnidadeInfo(unidadeId); // lança erro se a unidade não existir
  return {
    ok: true,
    token: _criarToken(s.usuario, s.papel, u.id),
    unidade: u
  };
}

/* ----------------------- Administração de usuários --------------------- */

/**
 * Cria ou atualiza um usuário (uso administrativo, chamado pelo master).
 * `dados` = { usuario, nome, papel, senha, ativo }.
 */
function salvarUsuario(dados) {
  var usuario = (dados.usuario || '').toString().trim().toLowerCase();
  if (!usuario) throw new Error('Usuário é obrigatório.');
  if (CONFIG.PAPEIS_VALIDOS.indexOf(dados.papel) === -1) {
    throw new Error('Papel inválido: ' + dados.papel);
  }

  var salt = _gerarSalt();
  var hash = _hashSenha(String(dados.senha || ''), salt);
  var ssAuth = _ssAutenticacao();
  var sh = _aba(CONFIG.SHEETS.USUARIOS, USUARIOS_HEADERS, ssAuth);
  var registros = lerRegistros(CONFIG.SHEETS.USUARIOS, ssAuth);
  var existente = registros.filter(function (r) {
    return String(r.USUARIO).trim().toLowerCase() === usuario;
  })[0];

  var linha = {
    USUARIO: usuario,
    NOME: dados.nome || usuario,
    PAPEL: dados.papel,
    SALT: salt,
    SENHA_HASH: hash,
    ATIVO: dados.ativo === false ? 'NÃO' : 'SIM'
  };

  if (existente) {
    // Se a senha vier vazia numa edição, mantém a senha atual.
    if (!dados.senha) {
      linha.SALT = existente.SALT;
      linha.SENHA_HASH = existente.SENHA_HASH;
    }
    USUARIOS_HEADERS.forEach(function (col) {
      atualizarCelula(CONFIG.SHEETS.USUARIOS, existente.__row, col, linha[col], ssAuth);
    });
  } else {
    acrescentarRegistro(CONFIG.SHEETS.USUARIOS, linha, USUARIOS_HEADERS, ssAuth);
  }
  return { ok: true };
}

/**
 * Setup inicial: cria a aba USUARIOS e um usuário master.
 * Rode UMA vez pelo editor do Apps Script (menu Executar → inicializarSistema).
 * A senha inicial do master é lida da Propriedade do script SENHA_MASTER_INICIAL;
 * se não existir, usa 'marfim@123' (TROQUE assim que entrar).
 */
function inicializarSistema() {
  var ssAuth = _ssAutenticacao();
  _aba(CONFIG.SHEETS.USUARIOS, USUARIOS_HEADERS, ssAuth);
  var jaExiste = lerRegistros(CONFIG.SHEETS.USUARIOS, ssAuth).some(function (r) {
    return String(r.PAPEL).trim() === CONFIG.PAPEIS.MASTER;
  });
  if (jaExiste) {
    Logger.log('Já existe um usuário master. Nada a fazer.');
    return;
  }
  var senha = PropertiesService.getScriptProperties()
    .getProperty('SENHA_MASTER_INICIAL') || 'marfim@123';
  salvarUsuario({
    usuario: 'master',
    nome: 'Administrador',
    papel: CONFIG.PAPEIS.MASTER,
    senha: senha,
    ativo: true
  });
  Logger.log('Usuário master criado. Login: master  |  Senha: ' + senha +
             '  →  TROQUE a senha após o primeiro acesso.');
}
