/**
 * FioCru.gs
 * Estoque de fio crú (fios recebidos por NF, ainda não tingidos) e sua baixa
 * conforme o tingimento vai consumindo cada tipo de fio.
 *
 * FIO_CRU_ENTRADAS: cada linha é um LOTE — uma NF pode ter várias linhas
 * (uma por tipo de fio, ex.: a mesma NF traz Poliéster e Brilhante).
 *
 * FIO_CRU_BAIXAS: histórico — uma linha por lote afetado em cada baixa (uma
 * baixa só pode virar 2+ linhas se ela "atravessar" de um lote pro outro).
 *
 * Regra da baixa (FIFO por DATA da NF, dentro do mesmo tipo de fio):
 *   - desconta do lote mais antigo com saldo > 0;
 *   - quando ele zera, passa pro próximo lote mais antigo do mesmo tipo;
 *   - se não houver NENHUM lote com saldo, continua descontando do ÚLTIMO
 *     lote (o mais recente) — pode ficar NEGATIVO; não trava o lançamento;
 *   - um lote NOVO nasce com o próprio saldo cheio, nunca herda o negativo
 *     de um lote anterior (o saldo de cada lote é sempre "sua própria
 *     quantidade menos suas próprias baixas", nada é somado entre lotes).
 * Lotes com SITUAÇÃO = CANCELADO nunca entram na conta.
 *
 * O tipo de fio do item confirmado vem do TIPO_FIO já identificado na
 * análise de compra (coluna TIPO_FIO de PENDENCIA_COMPRA). Pra achar o
 * lote certo, primeiro consulta a Associação Fio Crú (aba
 * ASSOCIACAO_FIO_CRU — tipo de fio da BASE TINGIMENTO → descrição usada no
 * estoque); sem associação cadastrada, cai no casamento por "contém"
 * (normalizado), pra não quebrar por uma pequena diferença de redação
 * entre as duas planilhas (ex.: "Poliester" vs "Fio Poliester").
 *
 * Um lote pode ser marcado como INÍCIO DA BAIXA daquele tipo de fio (ver
 * `definirInicioBaixaFioCru`) — lotes do mesmo tipo com data ANTERIOR a ele
 * saem da conta (tratados como já consumidos antes deste controle
 * existir), sem precisar cancelar um por um.
 *
 * FIO_CRU_ENTRADAS e FIO_CRU_BAIXAS são POR UNIDADE (cada empresa tem seu
 * próprio estoque — ver `_ss`/`_unidadeAtivaId`). Já ASSOCIACAO_FIO_CRU é
 * UNIVERSAL: a nomenclatura de tipo de fio é a mesma em todas as unidades,
 * então mora sempre na planilha da unidade padrão, independente de qual
 * unidade está ativa (ver `_ssAssociacaoFioCru`) — associar uma vez vale
 * pra todas as empresas.
 */

var FIO_CRU_ENTRADAS_HEADERS = [
  'TIPO_FIO', 'NF', 'FORNECEDOR', 'QUANTIDADE', 'PRECO_UNITARIO', 'DATA', 'SITUACAO', 'INICIO_BAIXA',
  'EDITADO_EM', 'EDITADO_POR'
];
var FIO_CRU_BAIXAS_HEADERS = ['DATA_HORA', 'TIPO_FIO', 'NF', 'DATA_NF', 'ITEM', 'QUANTIDADE', 'SALDO_NF_APOS', 'USUARIO'];
var ASSOCIACAO_FIO_CRU_HEADERS = ['TIPO_FIO_BASE', 'TIPO_FIO_ESTOQUE'];
var FIO_CRU_AJUSTES_HEADERS = ['DATA_HORA', 'TIPO_FIO', 'NF', 'DATA_NF', 'QUANTIDADE', 'MOTIVO', 'SALDO_NF_APOS', 'USUARIO'];
// QUANTIDADE (valor recebido na NF) fica de fora de propósito: é histórico
// fixo, nunca editável — ver `ajustarSaldoFioCru` pra corrigir o saldo sem
// tocar nesse valor original.
var FIO_CRU_CAMPOS_EDITAVEIS = ['TIPO_FIO', 'NF', 'FORNECEDOR', 'PRECO_UNITARIO', 'DATA'];

/**
 * ASSOCIACAO_FIO_CRU é universal — mora sempre na planilha da unidade
 * padrão (CONFIG.UNIDADE_PADRAO), igual à aba USUARIOS (ver
 * `_ssAutenticacao`, em Auth.gs). Defina SPREADSHEET_ID_ASSOCIACAO_FIO_CRU
 * nas Propriedades do script pra guardar num lugar à parte, se preferir.
 */
function _ssAssociacaoFioCru() {
  var idFixo = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID_ASSOCIACAO_FIO_CRU');
  return _ss(idFixo || CONFIG.getSpreadsheetId(CONFIG.UNIDADE_PADRAO));
}

/**
 * Casos especiais de tingimento — itens cujo CÓDIGO cai num tipo (ex.:
 * "102 lavado") que, só pra CALCULAR o pedido de fio, usa as máquinas de
 * OUTRO tipo da BASE TINGIMENTO (ex.: poliéster), mas que pra todo o resto
 * (tela, baixa no estoque de fio crú, relatórios) continua sendo o tipo
 * PRÓPRIO. Ou seja: o pedido "empresta" a base do poliéster; o estoque
 * continua sendo o "Fio 102 Lavado", e a baixa sai do lote com esse nome.
 * Universal (a composição do fio não muda por unidade) — adicione novos
 * casos aqui conforme aparecerem.
 *   - kws:            palavras (normalizadas) que precisam aparecer TODAS no
 *                     código do item pra ele cair neste caso
 *   - baseTingimento: padrão (coluna A da BASE TINGIMENTO, normalizado) cujas
 *                     máquinas/capacidades o cálculo do pedido deve usar
 *   - tipoFio:        tipo de fio atribuído ao item (tela + baixa do estoque —
 *                     precisa casar com a descrição do lote no fio crú)
 */
var _CASOS_ESPECIAIS_TINGIMENTO = [
  { kws: ['102', 'lavado'], baseTingimento: 'poliester', tipoFio: 'Fio 102 Lavado' }
];

/** Caso especial cujo `kws` todos aparecem no código do item (ou null). */
function _casoEspecialTingimento(item) {
  var it = _norm(item);
  if (!it) return null;
  return _CASOS_ESPECIAIS_TINGIMENTO.filter(function (c) {
    return c.kws.every(function (kw) { return it.indexOf(_norm(kw)) !== -1; });
  })[0] || null;
}

/** Dois textos de tipo de fio "batem" se um contém o outro (normalizado). */
function _tipoFioBate(a, b) {
  var na = _norm(a), nb = _norm(b);
  if (!na || !nb) return false;
  return na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1;
}

/** Chave de um lote: tipo de fio (como veio na aba) + nº da NF, normalizados. */
function _chaveLoteFioCru(tipoFio, nf) {
  var t = _norm(tipoFio);
  var n = _normNumero(nf) || _norm(nf);
  return t && n ? t + '|' + n : '';
}

/**
 * Garante que a aba FIO_CRU_ENTRADAS tem todas as colunas do cabeçalho
 * atual — acrescenta no fim as que ainda não existirem (ex.: INICIO_BAIXA,
 * adicionada depois da primeira versão), sem apagar nada. Chamar antes de
 * qualquer leitura/gravação nessa aba.
 */
function _prepararFioCruEntradas() {
  var sh = _aba(CONFIG.SHEETS.FIO_CRU_ENTRADAS, FIO_CRU_ENTRADAS_HEADERS);
  var largura = sh.getLastColumn();
  var atuais = largura ? sh.getRange(1, 1, 1, largura).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  FIO_CRU_ENTRADAS_HEADERS.forEach(function (h) {
    if (atuais.indexOf(h) === -1) {
      atuais.push(h);
      sh.getRange(1, atuais.length).setValue(h)
        .setFontWeight('bold').setBackground('#0F5FA0').setFontColor('#FFFFFF');
    }
  });
  return sh;
}

/** Lê a aba FIO_CRU_ENTRADAS (um lote por linha). */
function _lerLotesFioCru() {
  _prepararFioCruEntradas();
  return lerRegistros(CONFIG.SHEETS.FIO_CRU_ENTRADAS)
    .map(function (r) {
      return {
        linha: r.__row,
        tipoFio: r.TIPO_FIO == null ? '' : String(r.TIPO_FIO).trim(),
        nf: r.NF,
        fornecedor: r.FORNECEDOR == null ? '' : String(r.FORNECEDOR).trim(),
        quantidade: Number(r.QUANTIDADE) || 0,
        precoUnitario: Number(r.PRECO_UNITARIO) || 0,
        data: _parseData(r.DATA),
        situacao: r.SITUACAO == null ? '' : String(r.SITUACAO).trim(),
        cancelado: _norm(r.SITUACAO).indexOf('cancelado') !== -1,
        inicioBaixa: _norm(r.INICIO_BAIXA) === 'sim',
        editadoEm: r.EDITADO_EM instanceof Date ? r.EDITADO_EM : null,
        editadoPor: r.EDITADO_POR == null ? '' : String(r.EDITADO_POR).trim(),
        chave: _chaveLoteFioCru(r.TIPO_FIO, r.NF)
      };
    })
    .filter(function (l) { return l.chave; });
}

/** Soma de baixas já registradas por lote (chave = tipo de fio + NF). */
function _baixasPorLoteFioCru() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS).forEach(function (r) {
    var k = _chaveLoteFioCru(r.TIPO_FIO, r.NF);
    if (!k) return;
    mapa[k] = (mapa[k] || 0) + (Number(r.QUANTIDADE) || 0);
  });
  return mapa;
}

/** Soma de ajustes manuais de saldo já registrados por lote (ver `ajustarSaldoFioCru`). */
function _ajustesPorLoteFioCru() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.FIO_CRU_AJUSTES).forEach(function (r) {
    var k = _chaveLoteFioCru(r.TIPO_FIO, r.NF);
    if (!k) return;
    mapa[k] = (mapa[k] || 0) + (Number(r.QUANTIDADE) || 0);
  });
  return mapa;
}

/** Todos os lotes com o saldo atual já calculado (quantidade original −
 * baixas + ajustes manuais — ver `ajustarSaldoFioCru`). A QUANTIDADE em si
 * nunca é tocada por baixa nem por ajuste, só o saldo derivado dela. */
function _saldosFioCru() {
  var baixas = _baixasPorLoteFioCru();
  var ajustes = _ajustesPorLoteFioCru();
  return _lerLotesFioCru().map(function (l) {
    var baixado = baixas[l.chave] || 0;
    var ajustado = ajustes[l.chave] || 0;
    return {
      linha: l.linha, tipoFio: l.tipoFio, nf: l.nf, fornecedor: l.fornecedor,
      quantidade: l.quantidade, precoUnitario: l.precoUnitario, data: l.data,
      situacao: l.situacao, cancelado: l.cancelado, inicioBaixa: l.inicioBaixa,
      editadoEm: l.editadoEm, editadoPor: l.editadoPor, chave: l.chave,
      baixado: baixado, ajustado: ajustado, saldo: l.quantidade - baixado + ajustado
    };
  });
}

/** Associação tipo de fio (BASE TINGIMENTO) → descrição usada no estoque de
 * fio crú: normalizado(TIPO_FIO_BASE) → TIPO_FIO_ESTOQUE. Universal (ver
 * `_ssAssociacaoFioCru`) — não depende da unidade ativa. */
function _lerMapaTipoFio() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.ASSOCIACAO_FIO_CRU, _ssAssociacaoFioCru()).forEach(function (r) {
    var k = _norm(r.TIPO_FIO_BASE);
    if (k) mapa[k] = String(r.TIPO_FIO_ESTOQUE || '').trim();
  });
  return mapa;
}

/** Tipo de fio a procurar no estoque: usa a associação cadastrada quando
 * existir; sem associação, devolve o próprio texto original (cai no
 * casamento por "contém" de sempre). */
function _resolverTipoFioEstoque(tipoFioBase) {
  var mapeado = _lerMapaTipoFio()[_norm(tipoFioBase)];
  return mapeado || tipoFioBase;
}

/** Tipos de fio distintos cadastrados na aba BASE TINGIMENTO, na ordem em
 * que aparecem — pra montar a lista da Associação Fio Crú. */
function _listarTiposFioBase() {
  var vistos = {}, out = [];
  _lerBaseTingimento().forEach(function (b) {
    if (!b.tipoFio || vistos[_norm(b.tipoFio)]) return;
    vistos[_norm(b.tipoFio)] = true;
    out.push(b.tipoFio);
  });
  return out;
}

/** Tipos de fio distintos já cadastrados no estoque de fio crú (FIO_CRU_ENTRADAS)
 * da unidade ATIVA agora. */
function _listarTiposFioEstoque() {
  var vistos = {}, out = [];
  _lerLotesFioCru().forEach(function (l) {
    if (!l.tipoFio || vistos[_norm(l.tipoFio)]) return;
    vistos[_norm(l.tipoFio)] = true;
    out.push(l.tipoFio);
  });
  return out;
}

/** Tipos de fio distintos já cadastrados no estoque de fio crú de TODAS as
 * unidades — a associação é universal, então as opções pra associar juntam
 * o que já foi cadastrado em cada empresa, não só na unidade ativa agora. */
function _listarTiposFioEstoqueTodasUnidades() {
  var vistos = {}, out = [];
  CONFIG.UNIDADES.forEach(function (u) {
    var ss;
    try { ss = _ss(CONFIG.getSpreadsheetId(u.id)); } catch (e) { return; } // unidade sem planilha configurada ainda
    lerRegistros(CONFIG.SHEETS.FIO_CRU_ENTRADAS, ss).forEach(function (r) {
      var t = r.TIPO_FIO == null ? '' : String(r.TIPO_FIO).trim();
      if (!t || vistos[_norm(t)]) return;
      vistos[_norm(t)] = true;
      out.push(t);
    });
  });
  return out;
}

/**
 * Lista para a aba "Associação Fio Crú": cada tipo de fio da BASE
 * TINGIMENTO (da unidade ativa) com a descrição do estoque já associada
 * (se houver) — a associação em si é universal (ver `_ssAssociacaoFioCru`),
 * e as opções de descrição juntam o estoque de todas as unidades.
 * @return {Object} { ok, linhas:[{tipoFioBase,tipoFioEstoque}], opcoesEstoque:[...] }
 */
function listarAssociacaoFioCru(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var mapa = _lerMapaTipoFio();
  var linhas = _listarTiposFioBase().map(function (t) {
    return { tipoFioBase: t, tipoFioEstoque: mapa[_norm(t)] || '' };
  });
  return { ok: true, linhas: linhas, opcoesEstoque: _listarTiposFioEstoqueTodasUnidades() };
}

/** Salva (cria ou atualiza) a associação de UM tipo de fio da base com a
 * descrição do estoque — universal, vale pra todas as unidades. */
function salvarAssociacaoFioCru(token, tipoFioBase, tipoFioEstoque) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  tipoFioBase = String(tipoFioBase || '').trim();
  if (!tipoFioBase) throw new Error('Tipo de fio inválido.');
  tipoFioEstoque = String(tipoFioEstoque == null ? '' : tipoFioEstoque).trim();

  var ss = _ssAssociacaoFioCru();
  var sh = _aba(CONFIG.SHEETS.ASSOCIACAO_FIO_CRU, ASSOCIACAO_FIO_CRU_HEADERS, ss);
  var existente = lerRegistros(CONFIG.SHEETS.ASSOCIACAO_FIO_CRU, ss)
    .filter(function (r) { return _norm(r.TIPO_FIO_BASE) === _norm(tipoFioBase); })[0];
  if (existente) {
    atualizarCelula(CONFIG.SHEETS.ASSOCIACAO_FIO_CRU, existente.__row, 'TIPO_FIO_ESTOQUE', tipoFioEstoque, ss);
  } else {
    sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[tipoFioBase, tipoFioEstoque]]);
  }
  return { ok: true };
}

/**
 * Dá baixa de `quantidade` no fio crú do tipo informado (ver regra no topo
 * do arquivo). Grava uma linha de histórico por lote afetado.
 * @return {Object} { ok, mensagem?, tipoFio, quantidade, lotes:[{nf,dataNf,quantidadeBaixada,saldoApos}] }
 */
function _baixarFioCru(tipoFio, quantidade, item, usuario) {
  tipoFio = String(tipoFio || '').trim();
  quantidade = Number(quantidade) || 0;
  if (!tipoFio) return { ok: false, mensagem: 'Item sem tipo de fio identificado — não é possível dar baixa no fio crú.' };
  if (quantidade <= 0) return { ok: false, mensagem: 'Informe uma quantidade tingida maior que zero.' };

  var tipoFioResolvido = _resolverTipoFioEstoque(tipoFio);
  var todos = _saldosFioCru()
    .filter(function (l) {
      if (l.cancelado) return false;
      return _tipoFioBate(l.tipoFio, tipoFioResolvido) || _tipoFioBate(l.tipoFio, tipoFio);
    })
    .sort(function (a, b) {
      if (!a.data && !b.data) return 0;
      if (!a.data) return 1;
      if (!b.data) return -1;
      return a.data.getTime() - b.data.getTime();
    });
  // Início de baixa marcado (ver `definirInicioBaixaFioCru`): lotes com data
  // ANTERIOR a ele saem da conta — tratados como já consumidos antes deste
  // controle existir.
  for (var i = 0; i < todos.length; i++) {
    if (todos[i].inicioBaixa) { todos = todos.slice(i); break; }
  }
  if (!todos.length) {
    return { ok: false, mensagem: 'Nenhuma NF de "' + tipoFio + '" encontrada no estoque de fio crú.' };
  }

  var restante = quantidade;
  var porChave = {}; // chave -> total baixado nesta chamada
  todos.filter(function (l) { return l.saldo > 0; }).forEach(function (l) {
    if (restante <= 0) return;
    var desconto = Math.min(l.saldo, restante);
    porChave[l.chave] = (porChave[l.chave] || 0) + desconto;
    restante -= desconto;
  });
  // Nenhum lote com saldo (ou sobrou depois de esgotar todos): desconta o que
  // falta do ÚLTIMO lote (o mais recente), mesmo que fique negativo.
  if (restante > 0) {
    var ultimo = todos[todos.length - 1];
    porChave[ultimo.chave] = (porChave[ultimo.chave] || 0) + restante;
  }

  var agora = new Date();
  var linhas = [], resultado = [];
  Object.keys(porChave).forEach(function (chave) {
    var lote = todos.filter(function (l) { return l.chave === chave; })[0];
    var qtd = porChave[chave];
    var saldoApos = lote.saldo - qtd;
    linhas.push([agora, lote.tipoFio, lote.nf, lote.data || '', item || '', qtd, saldoApos, usuario || '']);
    resultado.push({ tipoFio: lote.tipoFio, nf: lote.nf, fornecedor: lote.fornecedor || '', dataNf: _soData(lote.data), quantidadeBaixada: qtd, saldoApos: saldoApos });
  });
  // Ordena o retorno pela mesma ordem FIFO (mais antiga primeiro), pra ficar
  // legível na tela/e-mail.
  resultado.sort(function (a, b) {
    return todos.map(function (l) { return l.nf; }).indexOf(a.nf) -
      todos.map(function (l) { return l.nf; }).indexOf(b.nf);
  });

  var sh = _aba(CONFIG.SHEETS.FIO_CRU_BAIXAS, FIO_CRU_BAIXAS_HEADERS);
  sh.getRange(sh.getLastRow() + 1, 1, linhas.length, FIO_CRU_BAIXAS_HEADERS.length).setValues(linhas);

  return { ok: true, tipoFio: tipoFio, quantidade: quantidade, lotes: resultado };
}

/**
 * Ajusta a baixa de fio crú de UM item para um NOVO total confirmado — usado
 * na Confirmação de Embarque, quando o valor lançado antes (na "quantidade
 * tingida") é revisado/corrigido nessa etapa final, que é quem manda de
 * verdade. Só desconta ou credita a DIFERENÇA entre o que já estava baixado
 * e o valor novo — nunca duplica a baixa original, e nunca edita/apaga uma
 * linha antiga do histórico (só acrescenta o ajuste).
 *   - diferença POSITIVA (valor novo é maior): desconta a mais, pelo mesmo
 *     FIFO de sempre (ver `_baixarFioCru`).
 *   - diferença NEGATIVA (valor novo é menor): credita de volta, desfazendo
 *     primeiro a baixa MAIS RECENTE deste item, depois a anterior, e assim
 *     por diante (LIFO) — como uma baixa negativa no histórico.
 * @return {Object} { ok, mensagem?, tipoFio, diferenca, lotes:[{nf,dataNf,quantidadeBaixada,saldoApos}] }
 */
function _ajustarBaixaFioCru(tipoFio, item, novoTotal, usuario) {
  item = String(item || '').trim();
  novoTotal = Number(novoTotal) || 0;
  var atual = _tingidoPorItem()[_norm(item)] || 0;
  var diferenca = novoTotal - atual;
  if (Math.abs(diferenca) < 0.001) return { ok: true, tipoFio: tipoFio, diferenca: 0, lotes: [] };

  if (diferenca > 0) {
    var baixa = _baixarFioCru(tipoFio, diferenca, item, usuario);
    if (!baixa.ok) return baixa;
    return { ok: true, tipoFio: baixa.tipoFio, diferenca: diferenca, lotes: baixa.lotes };
  }

  var porItem = lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS)
    .filter(function (r) { return _norm(r.ITEM) === _norm(item) && (Number(r.QUANTIDADE) || 0) > 0; })
    .sort(function (a, b) {
      var da = a.DATA_HORA instanceof Date ? a.DATA_HORA.getTime() : 0;
      var db = b.DATA_HORA instanceof Date ? b.DATA_HORA.getTime() : 0;
      return db - da; // mais recente primeiro
    });

  var restante = -diferenca;
  var agora = new Date();
  var linhas = [], resultado = [];
  for (var i = 0; i < porItem.length && restante > 0.001; i++) {
    var r = porItem[i];
    var credito = Math.min(Number(r.QUANTIDADE) || 0, restante);
    restante -= credito;
    var chaveLote = _chaveLoteFioCru(r.TIPO_FIO, r.NF);
    var loteAtual = _saldosFioCru().filter(function (l) { return l.chave === chaveLote; })[0];
    var saldoApos = (loteAtual ? loteAtual.saldo : 0) + credito;
    linhas.push([agora, r.TIPO_FIO, r.NF, r.DATA_NF, item, -credito, saldoApos, usuario || '']);
    resultado.push({ tipoFio: r.TIPO_FIO, nf: r.NF, fornecedor: loteAtual ? (loteAtual.fornecedor || '') : '', dataNf: _soData(r.DATA_NF), quantidadeBaixada: -credito, saldoApos: saldoApos });
  }
  if (linhas.length) {
    var sh = _aba(CONFIG.SHEETS.FIO_CRU_BAIXAS, FIO_CRU_BAIXAS_HEADERS);
    sh.getRange(sh.getLastRow() + 1, 1, linhas.length, FIO_CRU_BAIXAS_HEADERS.length).setValues(linhas);
  }
  return { ok: true, tipoFio: tipoFio, diferenca: diferenca, lotes: resultado };
}

/**
 * Lista para a tela "Quantidade Tingida" — SEPARADA da tela "Relação de
 * compra / Tingimento" (que fica intocada; ver `obterListaTingimento`, em
 * Consultas.gs). É a mesma lista de itens do Pedido de Fio (PENDENCIA_COMPRA
 * em aberto, na mesma ordem por data limite), mas com o número/data do
 * pedido junto e o quanto já foi lançado como tingido — o processo de baixa
 * do fio crú começa por aqui. Pensada pra, no futuro, ser um trabalho de um
 * grupo de usuários à parte (por ora só o master usa — ver `exigirSessao`).
 * @return {Object} { ok, numeroPedido, dataPedido, linhas:[{linha,item,descricao,cliente,tipoFio,maquinas,total,tingido}] }
 */
function obterListaFioParaTingir(token) {
  // Lida por três telas com direitos diferentes: Quantidade Tingida
  // (tingimento edita, almoxarifado1 só vê) e Confirmar Embarque
  // (almoxarifado1 edita, tingimento só vê) — a leitura em si vale pros três.
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO, CONFIG.PAPEIS.ALMOX1]);
  var regs = _ordenarPorDataLimite(lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).filter(_emAberto));
  var tingidoPorItem = _tingidoPorItem();
  var linhas = regs.map(function (r) {
    return {
      linha: r.__row,
      item: r.ITEM,
      descricao: r.DESCRICAO,
      cliente: r.CLIENTE,
      tipoFio: r.TIPO_FIO,
      maquinas: r.MAQUINAS,
      total: r.SUGERIDO,
      tingido: tingidoPorItem[_norm(r.ITEM)] || 0,
      dataSolicitado: _soData(r.GERADO_EM)
    };
  });
  return {
    ok: true,
    numeroPedido: _numeroPedidoRelatorio(),
    dataPedido: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    linhas: linhas
  };
}

/** Tipo de fio de um item, pela lista pendente de compra (PENDENCIA_COMPRA). */
function _tipoFioDoItemPendente(item) {
  var itemNorm = _norm(item);
  var pendente = lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA)
    .filter(function (r) { return _norm(r.ITEM) === itemNorm; })[0];
  return pendente ? String(pendente.TIPO_FIO || '').trim() : '';
}

/**
 * Lança a quantidade tingida de UM item: acha o tipo de fio dele (pela
 * lista pendente de compra, PENDENCIA_COMPRA) e dá baixa no fio crú.
 * Por ora, só o master usa esta tela (papéis por item ainda serão
 * definidos) — ver `exigirSessao`.
 * @param {Object} params { item, quantidade }
 */
function registrarQuantidadeTingida(token, params) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  params = params || {};
  var item = String(params.item || '').trim();
  if (!item) throw new Error('Informe o item.');
  var quantidade = Number(params.quantidade);
  if (isNaN(quantidade) || quantidade <= 0) throw new Error('Quantidade tingida inválida.');

  var tipoFio = _tipoFioDoItemPendente(item);
  if (!tipoFio) {
    throw new Error('Não achei o tipo de fio do item "' + item + '" na lista pendente — confira se ele ainda está lá.');
  }

  var baixa = _baixarFioCru(tipoFio, quantidade, item, s.usuario);
  if (!baixa.ok) throw new Error(baixa.mensagem);
  return { ok: true, tipoFio: baixa.tipoFio, quantidade: baixa.quantidade, lotes: baixa.lotes };
}

/**
 * Corrige o total tingido já lançado de UM item pra um novo valor absoluto —
 * usado quando um lançamento na tela "Quantidade Tingida" foi feito errado
 * (ex.: um teste, ou valor digitado errado) e precisa ser desfeito/ajustado.
 * Ajusta a baixa no fio crú pela DIFERENÇA (credita de volta, LIFO, se o
 * novo total for menor — ver `_ajustarBaixaFioCru`), nunca duplica.
 */
function corrigirQuantidadeTingida(token, item, novoTotal) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  item = String(item || '').trim();
  if (!item) throw new Error('Informe o item.');
  novoTotal = Number(novoTotal);
  if (isNaN(novoTotal) || novoTotal < 0) throw new Error('Valor inválido.');

  var tipoFio = _tipoFioDoItemPendente(item);
  if (!tipoFio) {
    throw new Error('Não achei o tipo de fio do item "' + item + '" na lista pendente — confira se ele ainda está lá.');
  }

  var ajuste = _ajustarBaixaFioCru(tipoFio, item, novoTotal, s.usuario);
  if (!ajuste.ok) throw new Error(ajuste.mensagem || 'Não foi possível corrigir.');
  return { ok: true, tipoFio: ajuste.tipoFio, diferenca: ajuste.diferenca, lotes: ajuste.lotes, tingido: novoTotal };
}

/**
 * Soma, por item (normalizado), quanto já foi lançado como "tingido" no
 * histórico de baixas do fio crú — usado pra mostrar na tela de Tingimento
 * quanto já foi confirmado tingido de cada item.
 */
function _tingidoPorItem() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS).forEach(function (r) {
    var k = _norm(r.ITEM);
    if (!k) return;
    mapa[k] = (mapa[k] || 0) + (Number(r.QUANTIDADE) || 0);
  });
  return mapa;
}

/**
 * Lista os lotes de fio crú com saldo, pra tela de administração do
 * estoque (ver histórico, conferir saldos). Acessível só ao master por ora.
 */
function listarEstoqueFioCru(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var linhas = _saldosFioCru().map(function (l) {
    return {
      linha: l.linha, tipoFio: l.tipoFio, nf: l.nf, fornecedor: l.fornecedor,
      quantidade: l.quantidade, precoUnitario: l.precoUnitario, data: _soData(l.data),
      situacao: l.situacao, saldo: l.saldo, ajustado: l.ajustado, inicioBaixa: l.inicioBaixa,
      editadoEm: l.editadoEm ? Utilities.formatDate(l.editadoEm, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '',
      editadoPor: l.editadoPor
    };
  }).sort(function (a, b) {
    if (a.tipoFio !== b.tipoFio) return a.tipoFio.localeCompare(b.tipoFio);
    return _parseData(a.data) - _parseData(b.data);
  });
  // Tipos de fio distintos JÁ cadastrados no estoque (unidade ativa), pra
  // oferecer num seletor no lançamento de NF — assim o usuário escolhe um
  // existente em vez de redigitar (evita duplicar o mesmo fio com grafias
  // diferentes). Um tipo novo só entra pela opção "novo tipo" do formulário.
  var tipos = _listarTiposFioEstoque().sort(function (a, b) { return a.localeCompare(b); });
  return { ok: true, linhas: linhas, tipos: tipos };
}

/**
 * Saldo somado por tipo de fio (todos os lotes não cancelados) — pra
 * destacar rápido quais tipos estão baixos, num painel separado da lista
 * de lotes individuais.
 */
function listarSaldoPorTipoFio(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var porTipo = {};
  _saldosFioCru().filter(function (l) { return !l.cancelado; }).forEach(function (l) {
    var t = l.tipoFio || '(sem tipo)';
    porTipo[t] = (porTipo[t] || 0) + l.saldo;
  });
  var linhas = Object.keys(porTipo).map(function (t) {
    return { tipoFio: t, saldo: porTipo[t] };
  }).sort(function (a, b) { return a.tipoFio.localeCompare(b.tipoFio); });
  return { ok: true, linhas: linhas };
}

/** Chave de agrupamento de uma data, por dia/semana/mês (sempre ordenável como texto). */
function _chavePeriodoFioCru(data, agrupamento) {
  if (agrupamento === 'mes') {
    return Utilities.formatDate(data, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  if (agrupamento === 'semana') {
    var d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
    d.setDate(d.getDate() - d.getDay()); // volta pro domingo daquela semana
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return Utilities.formatDate(data, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Rótulo legível de uma chave de período (ver `_chavePeriodoFioCru`). */
function _rotuloPeriodoFioCru(chave, agrupamento) {
  if (agrupamento === 'mes') {
    var m = chave.match(/^(\d{4})-(\d{2})$/);
    return m ? m[2] + '/' + m[1] : chave;
  }
  var m2 = chave.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m2) return chave;
  var rotulo = m2[3] + '/' + m2[2] + '/' + m2[1];
  return agrupamento === 'semana' ? 'semana de ' + rotulo : rotulo;
}

/**
 * Histórico de consumo de fio crú por tipo de fio, num período [dataInicio,
 * dataFim] ('yyyy-MM-dd'), agrupado por dia, semana ou mês. Soma o valor
 * NETO das baixas (créditos de volta — valores negativos — já entram na
 * conta, então refletem o consumo real daquele intervalo).
 * @return {Object} { ok, linhas:[{tipoFio,periodo,quantidade}], totais:[{tipoFio,quantidade}] }
 */
function listarConsumoFioCru(token, dataInicio, dataFim, agrupamento) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var inicio = _parseDataISO(dataInicio);
  var fim = _parseDataISO(dataFim);
  if (!inicio || !fim) throw new Error('Informe as datas de início e fim.');
  if (inicio.getTime() > fim.getTime()) throw new Error('A data inicial não pode ser maior que a final.');
  fim.setHours(23, 59, 59, 999);
  agrupamento = ['dia', 'semana', 'mes'].indexOf(agrupamento) !== -1 ? agrupamento : 'dia';

  var grupos = {};      // "tipoFio||periodoChave" -> { tipoFio, periodoChave, quantidade }
  var totalPorTipo = {};
  lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS).forEach(function (r) {
    var data = r.DATA_HORA instanceof Date ? r.DATA_HORA : _parseData(r.DATA_HORA);
    if (!data || data.getTime() < inicio.getTime() || data.getTime() > fim.getTime()) return;
    var tipoFio = String(r.TIPO_FIO || '').trim() || '(sem tipo)';
    var qtd = Number(r.QUANTIDADE) || 0;
    var periodoChave = _chavePeriodoFioCru(data, agrupamento);
    var k = tipoFio + '||' + periodoChave;
    if (!grupos[k]) grupos[k] = { tipoFio: tipoFio, periodoChave: periodoChave, quantidade: 0 };
    grupos[k].quantidade += qtd;
    totalPorTipo[tipoFio] = (totalPorTipo[tipoFio] || 0) + qtd;
  });

  var linhas = Object.keys(grupos).map(function (k) {
    var g = grupos[k];
    return { tipoFio: g.tipoFio, periodo: _rotuloPeriodoFioCru(g.periodoChave, agrupamento), periodoChave: g.periodoChave, quantidade: g.quantidade };
  }).sort(function (a, b) {
    if (a.tipoFio !== b.tipoFio) return a.tipoFio.localeCompare(b.tipoFio);
    return a.periodoChave < b.periodoChave ? -1 : (a.periodoChave > b.periodoChave ? 1 : 0);
  });

  var totais = Object.keys(totalPorTipo).map(function (t) {
    return { tipoFio: t, quantidade: totalPorTipo[t] };
  }).sort(function (a, b) { return a.tipoFio.localeCompare(b.tipoFio); });

  return { ok: true, linhas: linhas, totais: totais };
}

/**
 * Marca uma NF como o INÍCIO da baixa daquele tipo de fio (ver regra no
 * topo do arquivo). Só pode haver UM início marcado por tipo de fio —
 * marcar um novo desmarca o anterior automaticamente.
 */
function definirInicioBaixaFioCru(token, linha) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  _prepararFioCruEntradas();

  var lotes = _lerLotesFioCru();
  var alvo = lotes.filter(function (l) { return l.linha === linha; })[0];
  if (!alvo) throw new Error('Lote não encontrado — a lista pode ter mudado, recarregue a tela.');

  lotes.filter(function (l) { return l.inicioBaixa && l.linha !== linha && _tipoFioBate(l.tipoFio, alvo.tipoFio); })
    .forEach(function (l) { atualizarCelula(CONFIG.SHEETS.FIO_CRU_ENTRADAS, l.linha, 'INICIO_BAIXA', ''); });
  atualizarCelula(CONFIG.SHEETS.FIO_CRU_ENTRADAS, linha, 'INICIO_BAIXA', 'SIM');
  return { ok: true };
}

/** Remove a marcação de início de baixa (volta ao FIFO normal, desde o começo). */
function removerInicioBaixaFioCru(token, linha) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  _prepararFioCruEntradas();
  atualizarCelula(CONFIG.SHEETS.FIO_CRU_ENTRADAS, linha, 'INICIO_BAIXA', '');
  return { ok: true };
}

/**
 * Edita um campo de um lote já lançado, pra corrigir um valor digitado
 * errado — grava também QUEM editou e QUANDO (colunas EDITADO_EM/
 * EDITADO_POR), pra ter rastro de quem alterou o quê. Cuidado ao editar
 * TIPO_FIO ou NF de um lote que já tem baixas: o histórico antigo continua
 * gravado com o tipo/NF ANTIGO, então pode "descolar" do lote editado (o
 * saldo dele passaria a ignorar essas baixas antigas) — o mais seguro é
 * corrigir isso antes de qualquer baixa acontecer no lote.
 */
function editarLoteFioCru(token, linha, campo, valor) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  if (FIO_CRU_CAMPOS_EDITAVEIS.indexOf(campo) === -1) throw new Error('Campo não editável: ' + campo);
  _prepararFioCruEntradas();

  var valorFinal;
  if (campo === 'QUANTIDADE' || campo === 'PRECO_UNITARIO') {
    valorFinal = Number(valor);
    if (isNaN(valorFinal) || valorFinal < 0) throw new Error('Valor numérico inválido.');
  } else if (campo === 'DATA') {
    valorFinal = _parseDataISO(valor);
    if (!valorFinal) throw new Error('Data inválida.');
  } else {
    valorFinal = String(valor == null ? '' : valor).trim();
    if (!valorFinal) throw new Error('Valor não pode ficar vazio.');
  }
  atualizarCelula(CONFIG.SHEETS.FIO_CRU_ENTRADAS, linha, campo, valorFinal);
  atualizarCelula(CONFIG.SHEETS.FIO_CRU_ENTRADAS, linha, 'EDITADO_EM', new Date());
  atualizarCelula(CONFIG.SHEETS.FIO_CRU_ENTRADAS, linha, 'EDITADO_POR', s.usuario);
  return { ok: true };
}

/**
 * Ajusta manualmente o SALDO de um lote (ex.: depois de uma contagem física
 * de estoque), sem nunca alterar a QUANTIDADE original recebida na NF — essa
 * fica sempre fixa, como registro histórico de quanto entrou em cada nota.
 * Funciona como um lançamento à parte (ledger próprio, FIO_CRU_AJUSTES),
 * igual ao histórico de baixas: nunca reescreve um ajuste anterior, só
 * acrescenta um novo.
 * @param {number} delta Diferença a aplicar no saldo (positiva ou negativa).
 * @param {string} motivo Justificativa do ajuste (obrigatória).
 */
function ajustarSaldoFioCru(token, linha, delta, motivo) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  delta = Number(delta);
  if (isNaN(delta) || delta === 0) throw new Error('Informe uma diferença de saldo diferente de zero.');
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('Informe o motivo do ajuste.');

  var lote = _saldosFioCru().filter(function (l) { return l.linha === linha; })[0];
  if (!lote) throw new Error('Lote não encontrado — a lista pode ter mudado, recarregue a tela.');

  var saldoApos = lote.saldo + delta;
  var sh = _aba(CONFIG.SHEETS.FIO_CRU_AJUSTES, FIO_CRU_AJUSTES_HEADERS);
  sh.getRange(sh.getLastRow() + 1, 1, 1, FIO_CRU_AJUSTES_HEADERS.length).setValues([[
    new Date(), lote.tipoFio, lote.nf, lote.data || '', delta, motivo, saldoApos, s.usuario || ''
  ]]);
  return { ok: true, saldoApos: saldoApos };
}

/** Histórico de ajustes manuais de saldo (mais recente primeiro), pra tela de administração. */
function listarAjustesFioCru(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var regs = lerRegistros(CONFIG.SHEETS.FIO_CRU_AJUSTES);
  var linhas = regs.map(function (r) {
    return {
      linha: r.__row,
      dataHora: r.DATA_HORA instanceof Date
        ? Utilities.formatDate(r.DATA_HORA, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
        : String(r.DATA_HORA || ''),
      tipoFio: r.TIPO_FIO, nf: r.NF, dataNf: _soData(r.DATA_NF),
      quantidade: r.QUANTIDADE, motivo: r.MOTIVO, saldoApos: r.SALDO_NF_APOS, usuario: r.USUARIO
    };
  }).reverse();
  return { ok: true, linhas: linhas };
}

/** Histórico de baixas do fio crú (mais recente primeiro), pra tela de administração. */
function listarBaixasFioCru(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var regs = lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS);
  var linhas = regs.map(function (r) {
    return {
      linha: r.__row,
      dataHora: r.DATA_HORA instanceof Date
        ? Utilities.formatDate(r.DATA_HORA, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
        : String(r.DATA_HORA || ''),
      tipoFio: r.TIPO_FIO, nf: r.NF, dataNf: _soData(r.DATA_NF), item: r.ITEM,
      quantidade: r.QUANTIDADE, saldoApos: r.SALDO_NF_APOS, usuario: r.USUARIO
    };
  }).reverse();
  return { ok: true, linhas: linhas };
}

/**
 * Monta uma linha de FIO_CRU_ENTRADAS alinhada ao cabeçalho atual (10 colunas:
 * TIPO_FIO, NF, FORNECEDOR, QUANTIDADE, PRECO_UNITARIO, DATA, SITUACAO,
 * INICIO_BAIXA, EDITADO_EM, EDITADO_POR) — evita erro de "nº de colunas não
 * corresponde" se o cabeçalho ganhar colunas novas. Campos de auditoria/marca
 * nascem vazios.
 */
function _linhaFioCruEntrada(o) {
  var por = {
    TIPO_FIO: o.tipoFio, NF: o.nf, FORNECEDOR: o.fornecedor, QUANTIDADE: o.quantidade,
    PRECO_UNITARIO: (o.precoUnitario === '' || o.precoUnitario == null) ? '' : o.precoUnitario,
    DATA: o.data, SITUACAO: o.situacao || '', INICIO_BAIXA: '', EDITADO_EM: '', EDITADO_POR: ''
  };
  return FIO_CRU_ENTRADAS_HEADERS.map(function (h) { return por.hasOwnProperty(h) ? por[h] : ''; });
}

/**
 * Cadastra manualmente uma NF (lote) nova de fio crú. Acessível só ao master.
 * @param {Object} params { tipoFio, nf, fornecedor, quantidade, precoUnitario, data:'yyyy-MM-dd' }
 */
function lancarNotaFioCru(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  params = params || {};
  var tipoFio = String(params.tipoFio || '').trim();
  var nf = String(params.nf || '').trim();
  var quantidade = Number(params.quantidade);
  var data = _parseDataISO(params.data);
  if (!tipoFio) throw new Error('Informe o tipo de fio.');
  if (!nf) throw new Error('Informe o número da NF.');
  if (isNaN(quantidade) || quantidade <= 0) throw new Error('Quantidade inválida.');
  if (!data) throw new Error('Data da NF inválida.');

  var sh = _prepararFioCruEntradas();
  var linha = _linhaFioCruEntrada({
    tipoFio: tipoFio, nf: nf, fornecedor: String(params.fornecedor || '').trim(),
    quantidade: quantidade, precoUnitario: Number(params.precoUnitario) || '', data: data
  });
  sh.getRange(sh.getLastRow() + 1, 1, 1, linha.length).setValues([linha]);
  return { ok: true };
}

/**
 * Marca/desmarca uma NF de fio crú como CANCELADA (some da conta de saldo,
 * mas o histórico de baixas já feito nela continua registrado).
 */
function definirSituacaoFioCru(token, linha, cancelado) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  atualizarCelula(CONFIG.SHEETS.FIO_CRU_ENTRADAS, linha, 'SITUACAO', cancelado ? 'CANCELADO' : '');
  return { ok: true };
}

/**
 * MIGRAÇÃO ÚNICA — importa a planilha "FIOS CRÚ MARFIM CEARÁ - Entradas por
 * NF" pra dentro da aba FIO_CRU_ENTRADAS (unidade Ceará). Idempotente: pula
 * qualquer linha [tipo de fio + NF] que já exista, não duplica se rodar de
 * novo. Rode pelo editor do Apps Script (Executar → importarFioCruCearaInicial).
 */
function importarFioCruCearaInicial() {
  _definirUnidadeAtiva('CEARA');
  var dados = [
    ['Fio Poliester', '115411', 'ANTEX', 3006.51, 16.13, '27/01/2026', ''],
    ['Fio 102 Lavado', '158370', 'AVANTI', 1000.00, 12.18, '30/12/2025', ''],
    ['Fio 102 Lavado', '158372', 'AVANTI', 3970.00, 12.70, '30/12/2025', ''],
    ['Fio Alpina', '160169', 'AVANTI', 2000.00, 15.92, '19/01/2026', ''],
    ['Fio Alpina', '164797', 'AVANTI', 2000.00, 15.71, '24/02/2024', ''],
    ['Fio Alpina', '167001', 'AVANTI', 3000.00, 18.40, '11/03/2026', ''],
    ['Fio Alpina', '167155', 'AVANTI', 2500.00, 18.40, '12/03/2026', ''],
    ['Fio Helanca', '41928', 'AVANTI', 1522.80, 26.70, '16/12/2025', ''],
    ['Fio Helanca', '42807', 'AVANTI', 1015.20, 26.70, '23/03/2026', ''],
    ['Fio Alpina', '178741', 'AVANTI', 4000.00, 17.51, '29/06/2026', ''],
    ['Fio Alpina', '8190', 'KTR', 1587.60, 18.90, '24/02/2026', ''],
    ['Fio 102 Lavado', '364736', 'UNIFI', 4486.90, 12.20, '26/05/2026', ''],
    ['Fio Brilhante', '361333', 'UNIFI', 1022.34, 17.10, '25/03/2026', ''],
    ['Fio Brilhante', '263275', 'UNIFI', 1012.35, 17.10, '29/04/2026', ''],
    ['Fio Pet Reflexx', '358237', 'UNIFI', 1000.65, 17.38, '26/01/2026', ''],
    ['Fio Pet Reflexx', '358238', 'UNIFI', 1000.00, 17.38, '26/01/2026', ''],
    ['Fio Pet Reflexx', '359655', 'UNIFI', 3000.40, 17.38, '24/02/2026', ''],
    ['Fio Pet Reflexx', '361333', 'UNIFI', 2003.30, 17.38, '25/06/2026', ''],
    ['Fio Pet Reflexx', '363262', 'UNIFI', 2001.96, 18.56, '29/04/2026', ''],
    ['Fio Poliester', '359761', 'UNIFI', 3012.35, 16.73, '25/02/2026', ''],
    ['Fio Poliester', '361333', 'UNIFI', 4010.36, 16.73, '25/03/2026', ''],
    ['Fio Poliester', '363261', 'UNIFI', 5007.95, 17.95, '29/04/2026', ''],
    ['Fio Poliester', '364719', 'UNIFI', 3004.20, 17.95, '26/05/2026', ''],
    ['Fio Poliester', '366510', 'UNIFI', 4001.23, 17.58, '26/06/2026', 'CANCELADO'],
    ['Fio Poliester', '366574', 'UNIFI', 2922.28, 17.58, '26/06/2026', ''],
    ['Fio Polimp', '361333', 'UNIFI', 1649.90, 17.58, '25/03/2026', '']
  ];

  var existentes = {};
  _lerLotesFioCru().forEach(function (l) { existentes[l.chave] = true; });

  var novas = [];
  dados.forEach(function (linha) {
    var data = _parseDataBR(linha[5]);
    var chave = _chaveLoteFioCru(linha[0], linha[1]);
    if (existentes[chave]) return;
    existentes[chave] = true;
    novas.push([linha[0], linha[1], linha[2], linha[3], linha[4], data, linha[6], '', '', '']);
  });

  if (novas.length) {
    var sh = _prepararFioCruEntradas();
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, FIO_CRU_ENTRADAS_HEADERS.length).setValues(novas);
  }
  var msg = novas.length + ' de ' + dados.length + ' lote(s) importado(s) (' +
    (dados.length - novas.length) + ' já existiam).';
  Logger.log(msg);
  return { importados: novas.length, jaExistiam: dados.length - novas.length };
}

/**
 * MIGRAÇÃO ÚNICA — importa a planilha "FIOS CRÚ MARFIM BAHIA - Entradas por
 * NF" pra dentro da aba FIO_CRU_ENTRADAS (unidade Bahia). Idempotente: pula
 * qualquer linha [tipo de fio + NF] que já exista (não duplica se rodar de
 * novo, nem se algum desses lotes já tiver sido lançado manualmente antes
 * pela tela). Rode pelo editor do Apps Script (Executar → importarFioCruBahiaInicial).
 */
function importarFioCruBahiaInicial() {
  _definirUnidadeAtiva('BAHIA');
  var dados = [
    ['Fio 102 Lavado', '158376', 'AVANTI', 3190.00, 12.70, '30/12/2025', ''],
    ['Fio 102 Lavado', '158374', 'AVANTI', 800.00, 12.18, '30/12/2025', ''],
    ['Fio 102 Lavado', '364737', 'UNIFI', 4010.80, 12.20, '26/05/2026', ''],
    ['Fio BT-76/36', '361269', 'UNIFI', 1009.91, 21.83, '25/03/2026', ''],
    ['Fio PET de 1 Cabo', '358239', 'UNIFI', 1393.20, 17.97, '26/01/2026', ''],
    ['Fio PET de 1 Cabo', '358240', 'UNIFI', 997.35, 17.97, '26/01/2026', ''],
    ['Fio PET de 1 Cabo', '361270', 'UNIFI', 609.05, 17.97, '25/03/2026', ''],
    ['Fio PET de 1 Cabo', '361269', 'UNIFI', 2003.75, 17.97, '25/03/2026', ''],
    ['Fio PET de 1 Cabo', '363253', 'UNIFI', 1507.00, 19.14, '29/04/2026', ''],
    ['Fio Polimp', '363252', 'UNIFI', 1010.25, 18.80, '29/04/2026', ''],
    ['Fio Poliéster', '359657', 'UNIFI', 3010.60, 16.73, '24/02/2026', ''],
    ['Fio Poliéster', '361269', 'UNIFI', 3015.30, 16.73, '25/03/2026', ''],
    ['Fio Poliéster', '364760', 'UNIFI', 3004.35, 17.95, '26/05/2026', ''],
    ['Fio Reflexx', '263251', 'UNIFI', 2006.00, 18.55, '29/04/2026', ''],
    ['Fio Reflexx Pet', '358241', 'UNIFI', 3005.55, 17.39, '26/01/2026', ''],
    ['Fio Reflexx Pet', '359656', 'UNIFI', 3004.10, 17.38, '24/02/2026', ''],
    ['Fio Reflexx Pet', '361269', 'UNIFI', 2005.15, 17.38, '25/03/2026', ''],
    ['Fio Reflexx Pet', '263254', 'UNIFI', 2005.41, 18.56, '29/04/2026', ''],
    ['Fio Reflexx Pet', '364718', 'UNIFI', 3010.10, 18.56, '26/05/2026', ''],
    ['Fio Reflexx Pet', '366526', 'UNIFI', 1879.39, 18.80, '26/06/2026', ''],
    ['Fio Helanca', '42809', 'VENTUNO', 1884.90, 26.70, '23/03/2026', '']
  ];

  var existentes = {};
  _lerLotesFioCru().forEach(function (l) { existentes[l.chave] = true; });

  var novas = [];
  dados.forEach(function (linha) {
    var data = _parseDataBR(linha[5]);
    var chave = _chaveLoteFioCru(linha[0], linha[1]);
    if (existentes[chave]) return;
    existentes[chave] = true;
    novas.push([linha[0], linha[1], linha[2], linha[3], linha[4], data, linha[6], '', '', '']);
  });

  if (novas.length) {
    var sh = _prepararFioCruEntradas();
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, FIO_CRU_ENTRADAS_HEADERS.length).setValues(novas);
  }
  var msg = novas.length + ' de ' + dados.length + ' lote(s) importado(s) (' +
    (dados.length - novas.length) + ' já existiam).';
  Logger.log(msg);
  return { importados: novas.length, jaExistiam: dados.length - novas.length };
}
