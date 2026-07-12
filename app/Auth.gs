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

function _criarToken(usuario, papel) {
  var payload = {
    u: usuario,
    p: papel,
    exp: Date.now() + CONFIG.SESSAO_HORAS * 3600 * 1000
  };
  var corpo = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return corpo + '.' + _assinar(corpo);
}

/**
 * Valida o token e devolve { usuario, papel } ou null se inválido/expirado.
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
    return { usuario: payload.u, papel: payload.p };
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

  var registros = lerRegistros(CONFIG.SHEETS.USUARIOS);
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

  return {
    ok: true,
    token: _criarToken(usuario, String(u.PAPEL).trim()),
    nome: String(u.NOME || u.USUARIO),
    papel: String(u.PAPEL).trim()
  };
}

/**
 * Revalida um token existente (usado quando o usuário recarrega a página).
 * Retorna { ok, nome, papel } ou { ok:false }.
 */
function validarSessao(token) {
  var s = _validarToken(token);
  if (!s) return { ok: false };
  var registros = lerRegistros(CONFIG.SHEETS.USUARIOS);
  var u = registros.filter(function (r) {
    return String(r.USUARIO).trim().toLowerCase() === s.usuario;
  })[0];
  if (!u || u.ATIVO === false) return { ok: false };
  return {
    ok: true,
    nome: String(u.NOME || u.USUARIO),
    papel: String(u.PAPEL).trim()
  };
}

/**
 * Garante, no servidor, que a requisição tem token válido e (opcionalmente)
 * um dos papéis permitidos. Retorna { usuario, papel } ou lança erro.
 * Toda função de dados deve chamar isto antes de ler/gravar.
 */
function exigirSessao(token, papeisPermitidos) {
  var s = _validarToken(token);
  if (!s) throw new Error('Sessão expirada. Faça login novamente.');
  if (papeisPermitidos && papeisPermitidos.length &&
      papeisPermitidos.indexOf(s.papel) === -1 && s.papel !== CONFIG.PAPEIS.MASTER) {
    throw new Error('Você não tem permissão para esta ação.');
  }
  return s;
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
  var sh = _aba(CONFIG.SHEETS.USUARIOS, USUARIOS_HEADERS);
  var registros = lerRegistros(CONFIG.SHEETS.USUARIOS);
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
      atualizarCelula(CONFIG.SHEETS.USUARIOS, existente.__row, col, linha[col]);
    });
  } else {
    acrescentarRegistro(CONFIG.SHEETS.USUARIOS, linha, USUARIOS_HEADERS);
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
  _aba(CONFIG.SHEETS.USUARIOS, USUARIOS_HEADERS);
  var jaExiste = lerRegistros(CONFIG.SHEETS.USUARIOS).some(function (r) {
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
