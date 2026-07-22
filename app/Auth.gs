/**
 * Auth.gs
 * Autenticação própria (usuário/senha), independente de conta Google.
 *
 * - Senhas: NUNCA armazenadas em texto puro. O login sempre valida pelo hash
 *   (salt aleatório por usuário + SHA-256 iterado) — irreversível, é o que
 *   protege a conta de verdade. Além disso, SENHA_LEGIVEL guarda a mesma
 *   senha cifrada de forma REVERSÍVEL (cifrador de fluxo com chave só nas
 *   Propriedades do Script — nunca na planilha), só pra permitir ao master
 *   "ver" a senha de um usuário na tela (ver `_cifrarSenha`/`_decifrarSenha`,
 *   `revelarSenhaUsuario`). Quem abre a planilha direto não lê nada — vê só
 *   texto cifrado, tanto no hash quanto na coluna legível.
 * - Sessão: token assinado (HMAC-SHA256) e sem estado no servidor. O token
 *   carrega usuário, papel e validade; a assinatura impede adulteração.
 *
 * Estrutura da aba USUARIOS:
 *   USUARIO | NOME | PAPEL | SALT | SENHA_HASH | ATIVO | SENHA_LEGIVEL
 */

var USUARIOS_HEADERS = ['USUARIO', 'NOME', 'PAPEL', 'SALT', 'SENHA_HASH', 'ATIVO', 'SENHA_LEGIVEL'];
var HASH_ITERACOES = 1000;

/**
 * Garante que a aba USUARIOS tem todas as colunas do cabeçalho atual —
 * acrescenta no fim as que ainda não existirem (ex.: SENHA_LEGIVEL,
 * adicionada depois da primeira versão), sem apagar nada.
 */
function _prepararUsuarios() {
  var ssAuth = _ssAutenticacao();
  var sh = _aba(CONFIG.SHEETS.USUARIOS, USUARIOS_HEADERS, ssAuth);
  var largura = sh.getLastColumn();
  var atuais = largura ? sh.getRange(1, 1, 1, largura).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  USUARIOS_HEADERS.forEach(function (h) {
    if (atuais.indexOf(h) === -1) {
      atuais.push(h);
      sh.getRange(1, atuais.length).setValue(h)
        .setFontWeight('bold').setBackground('#0F5FA0').setFontColor('#FFFFFF');
    }
  });
  return sh;
}

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

/* ------------------------- Senha legível (reversível) -------------------- */
// NÃO substitui o hash acima (que continua sendo o único usado pra validar
// login). Isto é só pra o master poder "ver" a senha de um usuário na tela —
// ver o aviso no topo do arquivo.

/** Chave secreta da cifra — só nas Propriedades do Script, nunca na
 * planilha. Gerada automaticamente na primeira vez que for necessária. */
function _chaveSenhaLegivel() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('CHAVE_SENHA_LEGIVEL');
  if (!k) {
    k = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('CHAVE_SENHA_LEGIVEL', k);
  }
  return k;
}

/** `tamanho` bytes de keystream determinístico (chave + nonce), gerados em
 * blocos de HMAC-SHA256 num contador crescente — mesma ideia de um cifrador
 * de fluxo (tipo AES-CTR), usando HMAC como função pseudo-aleatória por não
 * haver uma cifra de bloco nativa disponível no Apps Script. */
function _keystreamSenha(nonce, tamanho) {
  var chave = _chaveSenhaLegivel();
  var bytes = [];
  var contador = 0;
  while (bytes.length < tamanho) {
    bytes = bytes.concat(Utilities.computeHmacSha256Signature(nonce + '|' + contador, chave));
    contador++;
  }
  return bytes.slice(0, tamanho);
}

/** Converte um valor 0-255 pro intervalo de byte assinado (-128..127) que o
 * Apps Script espera ao montar um Blob a partir de um array de números. */
function _paraByteAssinado(v) {
  v = v & 0xFF;
  return v >= 128 ? v - 256 : v;
}

/** Cifra um texto de forma REVERSÍVEL — devolve "nonce.cifradoBase64". Nonce
 * novo a cada chamada (nunca reaproveita o mesmo trecho de keystream). */
function _cifrarSenha(texto) {
  var nonce = Utilities.getUuid();
  var claros = Utilities.newBlob(String(texto == null ? '' : texto)).getBytes();
  var ks = _keystreamSenha(nonce, claros.length);
  var cifrados = claros.map(function (b, i) { return _paraByteAssinado((b & 0xFF) ^ (ks[i] & 0xFF)); });
  return nonce + '.' + Utilities.base64EncodeWebSafe(cifrados);
}

/** Decifra um texto gravado por `_cifrarSenha`. Devolve '' se o valor não
 * tiver o formato esperado (ex.: usuário criado antes deste recurso existir —
 * sem senha legível gravada, só o hash de login). */
function _decifrarSenha(valor) {
  valor = String(valor || '');
  var i = valor.indexOf('.');
  if (i === -1) return '';
  var nonce = valor.substring(0, i);
  var cifrados = Utilities.base64DecodeWebSafe(valor.substring(i + 1));
  var ks = _keystreamSenha(nonce, cifrados.length);
  var claros = cifrados.map(function (b, idx) { return _paraByteAssinado((b & 0xFF) ^ (ks[idx] & 0xFF)); });
  return Utilities.newBlob(claros).getDataAsString('UTF-8');
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

/** true se o valor da coluna ATIVO representa "ativo" (mesma regra do login). */
function _usuarioAtivo(valorAtivo) {
  var v = String(valorAtivo).trim().toUpperCase();
  return v !== 'NÃO' && v !== 'NAO' && valorAtivo !== false;
}

/**
 * Núcleo de criar/atualizar usuário — sem checar sessão, porque também é
 * chamado por `inicializarSistema` (rodado direto pelo editor do Apps
 * Script, sem token). Uso pela tela: sempre pela função pública
 * `salvarUsuario`, que exige sessão de master.
 * `dados` = { usuario, nome, papel, senha, ativo }. Se `senha` vier vazia
 * numa edição, mantém a senha (hash e legível) que já existia.
 */
function _salvarUsuarioInterno(dados) {
  dados = dados || {};
  var usuario = (dados.usuario || '').toString().trim().toLowerCase();
  if (!usuario) throw new Error('Usuário é obrigatório.');
  if (CONFIG.PAPEIS_VALIDOS.indexOf(dados.papel) === -1) {
    throw new Error('Papel inválido: ' + dados.papel);
  }

  var ssAuth = _ssAutenticacao();
  _prepararUsuarios();
  var registros = lerRegistros(CONFIG.SHEETS.USUARIOS, ssAuth);
  var existente = registros.filter(function (r) {
    return String(r.USUARIO).trim().toLowerCase() === usuario;
  })[0];

  var linha = {
    USUARIO: usuario,
    NOME: dados.nome || usuario,
    PAPEL: dados.papel,
    ATIVO: dados.ativo === false ? 'NÃO' : 'SIM'
  };

  if (dados.senha) {
    linha.SALT = _gerarSalt();
    linha.SENHA_HASH = _hashSenha(String(dados.senha), linha.SALT);
    linha.SENHA_LEGIVEL = _cifrarSenha(String(dados.senha));
  } else if (existente) {
    linha.SALT = existente.SALT;
    linha.SENHA_HASH = existente.SENHA_HASH;
    linha.SENHA_LEGIVEL = existente.SENHA_LEGIVEL;
  } else {
    throw new Error('Informe uma senha para o novo usuário.');
  }

  if (existente) {
    USUARIOS_HEADERS.forEach(function (col) {
      atualizarCelula(CONFIG.SHEETS.USUARIOS, existente.__row, col, linha[col], ssAuth);
    });
  } else {
    acrescentarRegistro(CONFIG.SHEETS.USUARIOS, linha, USUARIOS_HEADERS, ssAuth);
  }
  return { ok: true };
}

/**
 * Cria ou atualiza um usuário — só o master, pela tela de Usuários.
 * `dados` = { usuario, nome, papel, senha, ativo }.
 */
function salvarUsuario(token, dados) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  return _salvarUsuarioInterno(dados);
}

/** Lista os usuários (sem hash/senha) — só o master, pra tela de gestão. */
function listarUsuarios(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  _prepararUsuarios();
  var registros = lerRegistros(CONFIG.SHEETS.USUARIOS, _ssAutenticacao());
  return {
    ok: true,
    usuarios: registros.map(function (r) {
      return {
        usuario: r.USUARIO, nome: r.NOME, papel: r.PAPEL,
        ativo: _usuarioAtivo(r.ATIVO)
      };
    })
  };
}

/**
 * Decifra e devolve a senha de UM usuário — só quando o master pede
 * explicitamente (botão "ver senha"), nunca junto da listagem geral, pra não
 * expor todas as senhas de uma vez numa única chamada.
 */
function revelarSenhaUsuario(token, usuario) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  usuario = String(usuario || '').trim().toLowerCase();
  _prepararUsuarios();
  var r = lerRegistros(CONFIG.SHEETS.USUARIOS, _ssAutenticacao())
    .filter(function (x) { return String(x.USUARIO).trim().toLowerCase() === usuario; })[0];
  if (!r) throw new Error('Usuário não encontrado.');
  var senha = _decifrarSenha(r.SENHA_LEGIVEL);
  if (!senha) {
    throw new Error('Este usuário não tem senha legível gravada (foi criado antes deste recurso) — defina uma senha nova pra ele.');
  }
  return { ok: true, senha: senha };
}

/** Ativa/desativa um usuário sem precisar reenviar nome/papel/senha. */
function definirAtivoUsuario(token, usuario, ativo) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  usuario = String(usuario || '').trim().toLowerCase();
  var ssAuth = _ssAutenticacao();
  _prepararUsuarios();
  var r = lerRegistros(CONFIG.SHEETS.USUARIOS, ssAuth)
    .filter(function (x) { return String(x.USUARIO).trim().toLowerCase() === usuario; })[0];
  if (!r) throw new Error('Usuário não encontrado.');
  atualizarCelula(CONFIG.SHEETS.USUARIOS, r.__row, 'ATIVO', ativo ? 'SIM' : 'NÃO', ssAuth);
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
  _prepararUsuarios();
  var jaExiste = lerRegistros(CONFIG.SHEETS.USUARIOS, ssAuth).some(function (r) {
    return String(r.PAPEL).trim() === CONFIG.PAPEIS.MASTER;
  });
  if (jaExiste) {
    Logger.log('Já existe um usuário master. Nada a fazer.');
    return;
  }
  var senha = PropertiesService.getScriptProperties()
    .getProperty('SENHA_MASTER_INICIAL') || 'marfim@123';
  _salvarUsuarioInterno({
    usuario: 'master',
    nome: 'Administrador',
    papel: CONFIG.PAPEIS.MASTER,
    senha: senha,
    ativo: true
  });
  Logger.log('Usuário master criado. Login: master  |  Senha: ' + senha +
             '  →  TROQUE a senha após o primeiro acesso.');
}
