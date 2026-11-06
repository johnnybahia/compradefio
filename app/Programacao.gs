/**
 * Programacao.gs
 * Tela "Programação de Embarque": lista sozinha, toda vez que é aberta, as
 * cores (itens da aba ESTOQUE que batem com algum tipo de fio da BASE
 * TINGIMENTO, com lançamento nas últimas PROGRAMACAO_JANELA_DIAS dias) com
 * saldo crítico — negativo ou abaixo do limite desta unidade
 * (CONFIG.UNIDADES[].limiteSaldoCritico: 20 no Ceará, 10 na Bahia) — para o
 * master/Programação preencherem a data que precisam daquele embarque.
 *
 * Quem decide se a cor entra na lista (e a cor da linha) é um cálculo INTERNO:
 * saldo do estoque + o que está em viagem + o que já foi solicitado (pedido
 * aberto). Acima do limite = fora da lista; de 0 até o limite = amarelo;
 * negativo = vermelho. A tela, porém, mostra o Saldo só do estoque, com
 * "Em viagem" e "Solicitado" em colunas à parte — a soma nunca é exibida.
 *
 * Essa data é a nova fonte de DATA_LIMITE usada pela Análise de Compra (ver
 * `_criarLocalizadorDataLimite`, Analise.gs) — substitui a antiga planilha
 * PRIORIDADES DE FIO (importada nas colunas K/L de PEDIDO DE FIO), que não é
 * mais consultada.
 *
 * A lista não guarda histórico: quando uma cor deixa de estar em condição
 * crítica, sua linha (e a data preenchida) é apagada daqui — se ela voltar a
 * ficar crítica depois, reaparece na lista em branco, como uma necessidade
 * nova. Exceção: uma cor que JÁ tem data preenchida continua aparecendo
 * mesmo sem lançamento recente no ESTOQUE (só sai quando o saldo deixar de
 * ser crítico) — pra não sumir da lista um item que a Programação já está
 * acompanhando só porque ele não teve movimento nesses dias (ex.: já tingido,
 * parado esperando o embarque).
 *
 * Cor com estoque 0 nas DUAS filiais (o saldo do estoque, sem em viagem nem
 * solicitado) também sai em vermelho, mesmo sem saldo negativo, e vem logo
 * abaixo dos negativos. Em QUALQUER estoque 0 (nas duas filiais ou só aqui) as
 * cores com descrição vêm antes das sem descrição, dentro do seu bloco (ver
 * `_criarLocalizadorZeradoNaOutra` e `bloco`). O resto da lista segue como antes.
 */

var PROGRAMACAO_DATA_EMBARQUE_HEADERS = ['ITEM', 'DATA_NECESSARIA', 'USUARIO', 'ATUALIZADO_EM'];

/** Janela de "movimento recente" para uma cor entrar na lista (2 semanas). */
var PROGRAMACAO_JANELA_DIAS = 14;

/**
 * Garante que a aba existe e trava a coluna ITEM em texto puro — senão o
 * Sheets converte sozinho um código "cru" (ex.: "5108/1") em data ao gravar
 * (mesma armadilha documentada em NOTAS.md; padrão já usado em
 * `_prepararAbaCompra`/`_prepararEmbarques`).
 */
function _prepararProgramacaoEmbarque() {
  var sh = _aba(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, PROGRAMACAO_DATA_EMBARQUE_HEADERS);
  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  return sh;
}

/**
 * Trava de execução da aba PROGRAMACAO_DATA_EMBARQUE (mesmo padrão de
 * `_travaEmbarque`, em Embarque.gs). Evita duas gravações quase simultâneas
 * do MESMO item novo criarem linhas duplicadas, e evita que a limpeza feita
 * por `listarCoresCriticas` reescreva a aba por cima de uma gravação
 * concorrente de `salvarDataEmbarqueItem`.
 */
function _travaProgramacaoEmbarque() {
  var lock = LockService.getScriptLock();
  var pegou = false;
  try { pegou = lock.tryLock(15000); } catch (e) { pegou = false; }
  if (!pegou) {
    throw new Error('Muita gente mexendo na Programação de Embarque agora. Tente de novo em alguns segundos.');
  }
  return lock;
}

/** norm(item) → { item, dataNecessaria, usuario, atualizadoEm, row }. */
function _lerDatasProgramacao() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE).forEach(function (r) {
    var k = _norm(_itemDeCelula(r.ITEM));
    if (!k) return;
    mapa[k] = {
      item: _itemDeCelula(r.ITEM),
      dataNecessaria: _soData(r.DATA_NECESSARIA),
      usuario: _textoCelula(r.USUARIO),
      atualizadoEm: _dataHoraCelula(r.ATUALIZADO_EM),
      row: r.__row
    };
  });
  return mapa;
}

/** Saldo mais recente de cada item da aba ESTOQUE (mesmo critério de `listarItensParaAnalise`). */
function _saldoAtualPorItem(movimentos) {
  var porItem = {};
  (movimentos || _lerEstoque()).forEach(function (mov) {
    if (!mov.data) return;
    var chave = _norm(mov.item);
    if (!chave) return;
    if (!porItem[chave] || mov.data.getTime() > porItem[chave].data.getTime()) {
      porItem[chave] = { item: String(mov.item).trim(), data: mov.data, saldo: mov.saldo };
    }
  });
  return porItem;
}

/** Saldo "zero" para esta tela: tolerância de meio centésimo (o que a tela mostra como 0). */
function _saldoEhZero(v) {
  return v != null && !isNaN(v) && Math.abs(v) < 0.005;
}

/**
 * Devolve `fn(item)` → true quando o item tem estoque 0 TAMBÉM na outra
 * unidade. Só leitura: o estoque da outra filial serve apenas para decidir
 * cor/ordem, nunca é exibido nem gravado. Casamento do item igual ao de
 * `compararEstoqueEntreUnidades` (vínculo aprendido; senão código + tipo de fio).
 * Sem par na outra filial, saldo vazio ou falha ao ler a planilha dela = "não
 * confirmado" (false) — melhor não pintar vermelho do que pintar errado.
 */
function _criarLocalizadorZeradoNaOutra(unidadeAtiva) {
  var nunca = function () { return false; };
  var outraId = _outraUnidade(unidadeAtiva);
  if (!outraId) return nunca;
  var estoqueOutra, aprendido;
  try {
    estoqueOutra = _saldoPorItemUnidade(outraId);
    aprendido = _equivDe(unidadeAtiva, outraId);
  } catch (e) {
    return nunca; // sem acesso à outra planilha: a tela segue com a regra de antes
  }
  return function (item) {
    var alvo = null;
    var apr = aprendido[_norm(item)];
    if (apr) {
      alvo = estoqueOutra.porItem[_norm(apr)] || null;
    } else {
      var chave = _chaveEquivItem(item);
      if (chave) alvo = estoqueOutra.porChave[chave] || null;
    }
    return !!alvo && _saldoEhZero(alvo.saldo);
  };
}

/**
 * Lista as cores em condição crítica na unidade ativa, com a data já
 * preenchida (se houver), e limpa da aba PROGRAMACAO_DATA_EMBARQUE qualquer
 * cor que não está mais crítica — ver docstring do arquivo.
 * Cor com pedido (pendente ou em viagem) e consumo novo depois dele volta com
 * `novo: true` e a data em branco (`dataAnterior` guarda a antiga) — ver `_itensReabertos`.
 * `saldo`, `emViagem` e `solicitado` são só o que o operador vê; `negativo` (vermelho
 * x amarelo) e a própria presença na lista vêm do cálculo interno descrito no topo.
 * `negativo` também é true quando `zeradoAmbas` (estoque 0 aqui e na outra filial).
 * @return {Object} { ok, limite, itens: [{item, descricao, motivo, saldo, emViagem, solicitado, negativo, zeradoAmbas, dataNecessaria, novo, motivoNovo, dataAnterior}] }
 */
function listarCoresCriticas(token) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.PROGRAMACAO]);
  var limite = CONFIG.getUnidadeInfo(s.unidade).limiteSaldoCritico;
  _prepararProgramacaoEmbarque();

  // Mantém a ASSOCIAÇÃO em dia (mesmo passo que `listarItensParaAnalise` já
  // faz) — sem isso, uma cor crítica cujo código é novo na produção (ainda
  // não passou pela Análise de Compra) aparecia sem NENHUMA descrição aqui,
  // mesmo tendo uma perfeitamente disponível em PEDIDO DE FIO. Usa a versão
  // interna (sem checar sessão de novo) porque a pública é só-master, e esta
  // tela também é usada pelo papel Programação.
  _registrarItensNovosInterno();

  var movimentos = _lerEstoque(); // uma leitura só: saldo atual e reabertura (`_itensReabertos`)
  var porItem = _saldoAtualPorItem(movimentos);
  var emViagem = _emViagemPorItem();
  var emAberto = _emAbertoPorItem(); // "Solicitado": já pedido, aguardando envio (o "Já pendente" da Análise)
  var tipoFioDe = _criarLocalizadorTipoFio();
  var descricaoDe = _criarLocalizadorDescricao();
  var zeradoNaOutra = _criarLocalizadorZeradoNaOutra(s.unidade || CONFIG.UNIDADE_PADRAO);

  var salvasIniciais = _lerDatasProgramacao();
  var corte = new Date();
  corte = new Date(corte.getFullYear(), corte.getMonth(), corte.getDate() - PROGRAMACAO_JANELA_DIAS);

  var criticoSet = {};
  var base = [];
  Object.keys(porItem).forEach(function (k) {
    var r = porItem[k];
    if (!tipoFioDe(r.item)) return; // não é uma cor de fio (ex.: código de outro controle)
    // Cálculo interno (nunca exibido somado): estoque + em viagem + solicitado.
    // Se isso já cobre o limite, a cor não precisa de data de embarque agora.
    var saldoEfetivo = r.saldo + (emViagem[k] || 0) + (emAberto[k] || 0);
    if (saldoEfetivo >= limite) return;
    var recente = r.data.getTime() >= corte.getTime();
    // Sem movimento nas últimas 2 semanas, só entra se já tem data preenchida
    // (ver docstring do arquivo) — senão fica de fora, pra não acumular
    // código parado há tempos.
    if (!recente && !salvasIniciais[k]) return;
    criticoSet[k] = true;
    var d = descricaoDe(r.item);
    var negativo = saldoEfetivo < 0;
    // Estoque 0 aqui E na outra filial (só o estoque, sem em viagem/solicitado).
    var estoqueZero = _saldoEhZero(r.saldo);
    var zeradoAmbas = !negativo && estoqueZero && zeradoNaOutra(r.item);
    base.push({
      chave: k, item: r.item, saldo: r.saldo, saldoEfetivo: saldoEfetivo,
      negativo: negativo, estoqueZero: estoqueZero, zeradoAmbas: zeradoAmbas, desc: d
    });
  });

  // Datas já salvas. Se alguma cor salva não está mais crítica, limpa — mas
  // só entra na trava (e relê antes de escrever) quando isso é realmente
  // necessário, pra não serializar toda leitura da tela por causa de uma
  // limpeza que normalmente não acontece.
  var salvas = salvasIniciais;
  var chaves = Object.keys(salvas);
  var precisaLimpar = chaves.some(function (k) { return !criticoSet[k]; });
  if (precisaLimpar) {
    var lock = _travaProgramacaoEmbarque();
    try {
      var salvasFrescas = _lerDatasProgramacao(); // relê: pode ter mudado entre a leitura acima e a trava
      // Mantém quem está crítico OU quem apareceu/mudou depois da leitura
      // inicial (pode ter sido salvo agora mesmo por outra pessoa, num item
      // que nossa decisão de "crítico" não viu) — nunca apaga o que não foi
      // considerado na decisão; sobra pra próxima leitura reavaliar.
      var restantes = Object.keys(salvasFrescas).filter(function (k) {
        return criticoSet[k] || !salvasIniciais[k];
      }).map(function (k) { return salvasFrescas[k]; });
      if (restantes.length !== Object.keys(salvasFrescas).length) {
        reescreverAba(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, PROGRAMACAO_DATA_EMBARQUE_HEADERS,
          restantes.map(function (l) { return [l.item, l.dataNecessaria, l.usuario, l.atualizadoEm]; }));
      }
      salvas = {};
      restantes.forEach(function (l) { salvas[_norm(l.item)] = l; });
    } finally {
      lock.releaseLock();
    }
  }

  // Cor que já tem pedido (pendente ou em viagem) e teve consumo novo depois
  // dele: a data salva é da rodada anterior — aparece em branco, com o selo
  // "novo pedido", até alguém informar a nova (ver `_itensReabertos`).
  var reabertos = _itensReabertos(limite, movimentos, emViagem, emAberto, salvasIniciais);

  // Mais crítica primeiro, pelo mesmo cálculo interno que decidiu a lista e a cor,
  // em blocos: negativos → estoque 0 nas duas filiais (vermelho) COM descrição →
  // idem SEM descrição → estoque 0 só aqui (amarelo) COM descrição → idem SEM
  // descrição → o restante. Dentro de cada bloco vale a ordem de antes (sort estável).
  function bloco(b) {
    if (b.negativo) return 0;
    var semDesc = b.desc.descricao ? 0 : 1;
    if (b.zeradoAmbas) return 1 + semDesc;
    if (b.estoqueZero) return 3 + semDesc;
    return 5;
  }
  base.sort(function (a, b) {
    return (bloco(a) - bloco(b)) || (a.saldoEfetivo - b.saldoEfetivo);
  });

  var itens = base.map(function (b) {
    var salvo = salvas[b.chave];
    var rea = reabertos[b.chave] || null;
    var d = b.desc;
    return {
      item: b.item,
      descricao: d.descricao,
      motivo: d.motivo,
      saldo: b.saldo,                       // exibido: só o estoque (a soma interna não sai do servidor)
      emViagem: emViagem[b.chave] || 0,     // exibido, só consulta
      solicitado: emAberto[b.chave] || 0,   // exibido, só consulta
      negativo: b.negativo || b.zeradoAmbas, // vermelho: saldo negativo OU estoque 0 nas duas filiais
      zeradoAmbas: b.zeradoAmbas,
      dataNecessaria: rea ? '' : (salvo ? salvo.dataNecessaria : ''),
      novo: !!rea,
      motivoNovo: rea ? rea.motivo : '',
      dataAnterior: rea ? rea.dataAnterior : ''
    };
  });

  return { ok: true, limite: limite, itens: itens };
}

/**
 * Grava (ou apaga, se `data` vier vazio) a data que a Programação precisa
 * deste embarque, para a cor informada. Não valida se a cor ainda está em
 * condição crítica — quem decide isso é a lista (`listarCoresCriticas`); se
 * o saldo já tiver mudado, a próxima leitura da lista limpa a linha sozinha.
 * @param {string} data 'dd/MM/aaaa', ou '' para apagar.
 */
function salvarDataEmbarqueItem(token, item, data) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.PROGRAMACAO]);
  item = String(item == null ? '' : item).trim();
  if (!item) throw new Error('Informe a cor.');
  data = String(data == null ? '' : data).trim();
  if (data && !_parseDataBR(data)) throw new Error('Data inválida (use dd/mm/aaaa).');

  _prepararProgramacaoEmbarque();
  var lock = _travaProgramacaoEmbarque();
  try {
    return _gravarDataProgramacao(item, data, s.usuario || '');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Grava (ou apaga, se `data` vier vazio) a linha da cor em
 * PROGRAMACAO_DATA_EMBARQUE. O CHAMADOR precisa estar segurando
 * `_travaProgramacaoEmbarque` — usado por `salvarDataEmbarqueItem` e por
 * `gerarRelacaoDeCompra` (Analise.gs), que sincroniza a data nova de um item
 * reaberto.
 */
function _gravarDataProgramacao(item, data, usuario) {
  var linhaExistente = null;
  lerRegistros(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE).forEach(function (r) {
    if (_norm(_itemDeCelula(r.ITEM)) === _norm(item)) linhaExistente = r.__row;
  });

  if (!data) {
    if (linhaExistente) _aba(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE).deleteRow(linhaExistente);
    return { ok: true, apagado: true };
  }

  if (linhaExistente) {
    atualizarCelula(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, linhaExistente, 'DATA_NECESSARIA', data);
    atualizarCelula(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, linhaExistente, 'USUARIO', usuario || '');
    atualizarCelula(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, linhaExistente, 'ATUALIZADO_EM', new Date());
  } else {
    acrescentarRegistro(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE,
      { ITEM: item, DATA_NECESSARIA: data, USUARIO: usuario || '', ATUALIZADO_EM: new Date() },
      PROGRAMACAO_DATA_EMBARQUE_HEADERS);
  }
  return { ok: true };
}
