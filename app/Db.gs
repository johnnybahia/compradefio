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
 *
 * `contexto` (opcional): rótulo pro erro, quando o `Utilities`/`SpreadsheetApp`
 * recusa o acesso ("Você não tem permissão para acessar o documento
 * solicitado.") — sozinho, esse erro do Apps Script não diz QUAL planilha
 * falhou, e algumas leituras são "escondidas": ex. confirmar um embarque da
 * BAHIA lê a ASSOCIACAO_FIO_CRU, que por padrão mora na planilha do CEARÁ
 * (é universal, compartilhada entre as unidades — ver `_ssAssociacaoFioCru`).
 * Se essa planilha "escondida" perder acesso, o usuário vê o erro genérico
 * numa ação que parece não ter nada a ver com a outra unidade. Passar um
 * `contexto` aqui faz o erro já vir dizendo qual documento é.
 */
function _ss(idOpcional, contexto) {
  var id = idOpcional || CONFIG.getSpreadsheetId(_unidadeAtivaId);
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    var rotulo = contexto || ('unidade ativa "' + (_unidadeAtivaId || CONFIG.UNIDADE_PADRAO) + '"');
    throw new Error(
      'Sem acesso à planilha de ' + rotulo + ' (ID …' + String(id).slice(-8) + '). ' +
      'A conta que roda o sistema (a que fez a implantação do Web App) precisa ser ' +
      'editora dessa planilha — confira se ela ainda está compartilhada com essa conta ' +
      '(pode ter sido removida, ou a planilha movida/excluída). Erro original: ' + e.message
    );
  }
}

/**
 * Retorna a aba pelo nome. Se ela não existir e `headers` for informado,
 * cria a aba com o cabeçalho. `ssOpcional` permite operar numa planilha
 * específica em vez da unidade ativa (ver `_ss`).
 *
 * O nome VAZIO é recusado de propósito — era ele que enchia a planilha de abas
 * "PáginaNN". Quase todo mundo aqui chama `_aba(CONFIG.SHEETS.ALGO, …)`; se o
 * Config.gs implantado no editor for mais antigo que o arquivo que chamou (uma
 * chave nova ainda não colada lá), esse `CONFIG.SHEETS.ALGO` vem `undefined`.
 * Aí o Apps Script trata `insertSheet(undefined)` como `insertSheet()` — sem
 * nome — e o Google batiza a aba de "Página1", "Página2"… Como
 * `getSheetByName(undefined)` nunca acha nada, CADA chamada criava mais uma:
 * as que rodam a cada tela (ex.: `_atualizarPendenciasEmbarque`) fabricam
 * dezenas delas em silêncio, comendo 26 mil células cada uma. Melhor falhar
 * com uma mensagem que diz o que arrumar.
 */
function _aba(nome, headers, ssOpcional) {
  var nomeAba = (nome == null ? '' : String(nome)).trim();
  if (!nomeAba) {
    throw new Error(
      'Tentativa de abrir/criar uma aba sem nome. Isso quase sempre é o Config.gs ' +
      'implantado mais antigo que os outros arquivos: uma chave de CONFIG.SHEETS que ' +
      'o código já usa ainda não existe lá. Cole a versão nova do Config.gs no editor ' +
      'do Apps Script e rode de novo.'
    );
  }
  var ss = ssOpcional || _ss();
  var sh = ss.getSheetByName(nomeAba);
  if (!sh && headers && headers.length) {
    sh = ss.insertSheet(nomeAba);
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
 * mesma aba lógica — ex.: a coluna de volumes do embarque, que aparece como
 * "Volumes", "Caixas" ou "Cx" dependendo de quem montou a aba.
 *
 * Para a aba ESTOQUE, use `_colunasEstoque` (logo abaixo) em vez desta: lá as
 * colunas escolhidas ainda são CONFERIDAS contra os dados, o que esta função
 * sozinha não faz.
 */
function _colPorNomes(headerNormalizado, nomes) {
  for (var i = 0; i < nomes.length; i++) {
    var idx = headerNormalizado.indexOf(nomes[i]);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Nomes de coluna aceitos em cada campo lógico da aba ESTOQUE. A mesma aba
 * lógica nasceu em dois sistemas diferentes e as duas convenções continuam
 * valendo:
 *
 *   Ceará: `(A vazia) | Item | Data | NF | Obs | Saldo Anterior | Entrada |
 *           Saída | Saldo | Alterado Em | Alterado Por`
 *   Bahia: `GRUPO | DESCRIÇÃO | DATA LANÇAMENTO | NOTA FISCAL/PEDIDO |
 *           OBSERVAÇÕES | ESTOQUE ATUAL | ENTRADA | SAIDA | SALDO DE ESTOQUE |
 *           ALTERAÇÕES | USUÁRIO | OK`   (herdada do script antigo)
 *
 * Repare que as POSIÇÕES sempre foram as mesmas nas duas — só o texto do
 * cabeçalho mudava. Uma unidade pode migrar o cabeçalho pro padrão da outra
 * a qualquer momento (foi o que a Bahia fez), então o código aceita os dois
 * nomes e confere o resultado contra os dados (ver `_colunasEstoque`).
 */
var ESTOQUE_NOMES_COLUNA = {
  item:    ['item', 'descricao', 'produto'],
  data:    ['data', 'data lancamento'],
  nf:      ['nf', 'nota fiscal/pedido', 'nota fiscal'],
  obs:     ['obs', 'observacoes'],
  entrada: ['entrada'],
  saida:   ['saida'],
  saldo:   ['saldo', 'saldo de estoque']
};

/** Índice de cada campo lógico do ESTOQUE olhando SÓ o texto do cabeçalho. */
function _colunasEstoquePorNome(headerNormalizado) {
  var mapa = {};
  Object.keys(ESTOQUE_NOMES_COLUNA).forEach(function (campo) {
    mapa[campo] = _colPorNomes(headerNormalizado, ESTOQUE_NOMES_COLUNA[campo]);
  });
  return mapa;
}

/* ---- testes de conteúdo, pra conferir o cabeçalho contra os dados ---- */

/** Célula com algum conteúdo. */
function _celulaPreenchida(v) {
  return v !== '' && v != null && String(v).trim() !== '';
}

/**
 * Célula que é data DE VERDADE. De propósito mais rígido que `_parseData`:
 * aqui o valor só conta como data se for um Date da planilha ou um texto
 * dd/mm/aaaa. `_parseData` cai num `new Date(texto)` no fim, e isso aceita
 * código de item como se fosse ano (`new Date('4085')` → 01/01/4085) — o que
 * faria a coluna de ITEM passar por coluna de DATA justamente na hora de
 * decidir se o cabeçalho está alinhado.
 */
function _celulaData(v) {
  if (v instanceof Date) return !isNaN(v.getTime());
  return typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}(\s|$)/.test(v.trim());
}

/** Célula numérica (Date NÃO conta como número). */
function _celulaNumero(v) {
  if (typeof v === 'number') return isFinite(v);
  if (typeof v !== 'string') return false;
  var s = v.trim();
  return s !== '' && /^-?[\d.,]+$/.test(s) && !isNaN(parseFloat(s.replace(',', '.')));
}

/** Célula que parece código/descrição de item: preenchida e não é data. */
function _celulaItem(v) {
  return _celulaPreenchida(v) && !_celulaData(v);
}

/** Fração das linhas da amostra em que a coluna `col` passa em `teste`. */
function _fracaoColuna(amostra, col, teste) {
  if (col < 0 || !amostra.length) return 0;
  var n = 0;
  for (var i = 0; i < amostra.length; i++) {
    if (teste(amostra[i][col])) n++;
  }
  return n / amostra.length;
}

/**
 * Até 400 linhas COM CONTEÚDO da aba, olhando do fim pro começo (os
 * lançamentos mais recentes retratam o formato atual). Para de varrer depois
 * de 5.000 linhas pra não pagar caro por uma aba cheia de linhas vazias no fim.
 */
function _amostraEstoque(linhas) {
  var amostra = [];
  var vistas = 0;
  for (var i = linhas.length - 1; i >= 0 && amostra.length < 400 && vistas < 5000; i--) {
    vistas++;
    var linha = linhas[i];
    for (var c = 0; c < linha.length; c++) {
      if (_celulaPreenchida(linha[c])) { amostra.push(linha); break; }
    }
  }
  return amostra;
}

/**
 * Confere um mapa de colunas contra os DADOS: a coluna de item precisa estar
 * preenchida (e não ser data), a de data precisa conter datas de verdade e a
 * de saldo, números. É o que separa "cabeçalho alinhado com os dados" de
 * "cabeçalho escrito uma coluna fora do lugar".
 */
function _avaliarColunasEstoque(mapa, amostra) {
  var temEssenciais = mapa.item >= 0 && mapa.data >= 0 && mapa.saldo >= 0;
  var item = _fracaoColuna(amostra, mapa.item, _celulaItem);
  var data = _fracaoColuna(amostra, mapa.data, _celulaData);
  var saldo = _fracaoColuna(amostra, mapa.saldo, _celulaNumero);
  return {
    confere: temEssenciais && item >= 0.6 && data >= 0.7 && saldo >= 0.7,
    nota: item + data + saldo,
    item: item, data: data, saldo: saldo
  };
}

/** Move todos os índices do mapa em `d` colunas; null se sair do intervalo. */
function _deslocarColunasEstoque(mapa, d, largura) {
  var novo = {};
  var campos = Object.keys(mapa);
  for (var i = 0; i < campos.length; i++) {
    var idx = mapa[campos[i]];
    if (idx < 0) { novo[campos[i]] = -1; continue; }
    var alvo = idx + d;
    if (alvo < 0 || alvo >= largura) {
      // Coluna essencial jogada pra fora da aba: esse deslocamento não existe.
      if (campos[i] === 'item' || campos[i] === 'data' || campos[i] === 'saldo') return null;
      alvo = -1;
    }
    novo[campos[i]] = alvo;
  }
  return novo;
}

/**
 * Cabeçalho como texto legível, pras mensagens de erro. Corta as colunas
 * vazias do fim (a aba costuma ser mais larga que o cabeçalho) pra mensagem
 * não virar uma fileira de "(vazia)".
 */
function _textoCabecalhoEstoque(headerNormalizado) {
  var fim = headerNormalizado.length;
  while (fim > 0 && !headerNormalizado[fim - 1]) fim--;
  return headerNormalizado.slice(0, Math.min(fim, 20)).map(function (h) {
    return h ? h : '(vazia)';
  }).join(' | ') || '(linha 1 vazia)';
}

/**
 * Resolve as colunas da aba ESTOQUE de forma VERIFICADA: acha cada campo pelo
 * nome do cabeçalho (as duas convenções — ver `ESTOQUE_NOMES_COLUNA`) e
 * depois confere o resultado contra os dados da própria aba.
 *
 * Por que conferir, e não confiar só no nome: as duas unidades sempre tiveram
 * as MESMAS posições físicas (A vazia/GRUPO, B item, C data … I saldo) e só o
 * texto do cabeçalho mudava. Quando alguém migra o cabeçalho de uma unidade
 * pro padrão da outra, é fácil escrever os nomes começando na coluna errada —
 * ex.: digitar "Item" em A1, que na Bahia era o GRUPO, empurrando todos os
 * nomes uma coluna pra esquerda dos dados que eles descrevem. Aí cada nome
 * aponta pro vizinho: o sistema lê a SAÍDA como saldo e o código do item como
 * data. Nada disso dá erro — só entrega número errado na tela, que é o
 * sintoma difícil de rastrear. Conferindo contra os dados dá pra detectar o
 * desalinhamento e corrigir o deslocamento.
 *
 * @param {Array} headerNormalizado Linha 1 já passada por `_norm`.
 * @param {Array} linhas Linhas de dados (a aba SEM o cabeçalho).
 * @return {Object} { item, data, nf, obs, entrada, saida, saldo,
 *                    confere, deslocamento, diagnostico } — índices 0-based,
 *                    -1 quando o campo não existe na aba.
 */
function _colunasEstoque(headerNormalizado, linhas) {
  var base = _colunasEstoquePorNome(headerNormalizado);
  var amostra = _amostraEstoque(linhas || []);

  // Aba sem nenhum dado ainda: não há como conferir, fica o que o nome disse.
  if (!amostra.length) return _resultadoColunasEstoque(base, true, 0, '');

  if (_avaliarColunasEstoque(base, amostra).confere) {
    return _resultadoColunasEstoque(base, true, 0, '');
  }

  // Cabeçalho não bate com os dados: procura o deslocamento que bate.
  var largura = headerNormalizado.length;
  for (var i = 0; i < amostra.length; i++) {
    if (amostra[i].length > largura) largura = amostra[i].length;
  }
  var melhor = null;
  [-1, 1, -2, 2].forEach(function (d) {
    var alt = _deslocarColunasEstoque(base, d, largura);
    if (!alt) return;
    var aval = _avaliarColunasEstoque(alt, amostra);
    if (aval.confere && (!melhor || aval.nota > melhor.nota)) {
      melhor = { mapa: alt, nota: aval.nota, deslocamento: d };
    }
  });

  if (melhor) {
    var aviso = 'Aba ESTOQUE: o cabeçalho está ' + Math.abs(melhor.deslocamento) +
      ' coluna(s) ' + (melhor.deslocamento > 0 ? 'à ESQUERDA' : 'à DIREITA') +
      ' dos dados que descreve — lendo pelas colunas certas mesmo assim. ' +
      'Vale arrumar a linha 1 da aba. Cabeçalho encontrado: ' +
      _textoCabecalhoEstoque(headerNormalizado);
    Logger.log(aviso);
    return _resultadoColunasEstoque(melhor.mapa, true, melhor.deslocamento, aviso);
  }

  return _resultadoColunasEstoque(base, false, 0,
    'A aba ESTOQUE não está no formato esperado: não consegui casar as colunas ' +
    'Item, Data e Saldo com os dados. Cabeçalho encontrado: ' +
    _textoCabecalhoEstoque(headerNormalizado) + '. O padrão esperado é ' +
    '"Item | Data | NF | Obs | Saldo Anterior | Entrada | Saída | Saldo" ' +
    '(ou os nomes antigos: DESCRIÇÃO | DATA LANÇAMENTO | … | SALDO DE ESTOQUE), ' +
    'com cada nome na linha 1, em cima da coluna que ele descreve.');
}

/** Monta o retorno de `_colunasEstoque` (mapa + como ele foi decidido). */
function _resultadoColunasEstoque(mapa, confere, deslocamento, diagnostico) {
  return {
    item: mapa.item, data: mapa.data, nf: mapa.nf, obs: mapa.obs,
    entrada: mapa.entrada, saida: mapa.saida, saldo: mapa.saldo,
    confere: confere, deslocamento: deslocamento, diagnostico: diagnostico
  };
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
