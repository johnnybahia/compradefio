/**
 * Migracao.gs
 * Utilitário de ÚNICA execução — pode ser apagado depois de usado.
 *
 * Antes da separação em duas abas (PENDENCIA_COMPRA / RELACAO_COMPRA),
 * RELACAO_COMPRA era a ÚNICA lista de trabalho da compra — era ali que o
 * pedido acumulava. Quando o rascunho passou a ser PENDENCIA_COMPRA, a tela
 * de Tingimento e todo o resto do sistema passaram a ler só dela — o que já
 * estava em RELACAO_COMPRA ficou "preso" lá, invisível pro sistema.
 *
 * Estas funções trazem essas linhas de volta pra PENDENCIA_COMPRA, sem
 * duplicar o que já estiver pendente (mesma chave item + data limite usada
 * em `gerarRelacaoDeCompra`) e SEM apagar nada de RELACAO_COMPRA — só copia.
 * Forçam STATUS = ABERTO em tudo que migrar (mesmo o que porventura estava
 * marcado ENVIADO por engano, do período em que o envio arquivava errado).
 *
 * Como rodar: no editor do Apps Script, escolha no menu "Selecionar função"
 * `migrarRelacaoParaPendenciaCeara` (ou `...Bahia`) e clique em Executar —
 * uma vez para cada unidade que tiver dado em RELACAO_COMPRA. Não precisa
 * de login/sessão (roda direto, como qualquer função do editor). Pode rodar
 * de novo sem medo: é idempotente.
 */
function migrarRelacaoParaPendenciaCeara() { return _migrarRelacaoParaPendencia('CEARA'); }
function migrarRelacaoParaPendenciaBahia() { return _migrarRelacaoParaPendencia('BAHIA'); }

function _migrarRelacaoParaPendencia(unidadeId) {
  _definirUnidadeAtiva(unidadeId);

  var antigos = lerRegistros(CONFIG.SHEETS.RELACAO_COMPRA);
  if (!antigos.length) {
    Logger.log('%s: RELACAO_COMPRA está vazia — nada para migrar.', unidadeId);
    return { unidade: unidadeId, migrados: 0, jaPendentes: 0 };
  }

  var sh = _prepararAbaCompra(CONFIG.SHEETS.PENDENCIA_COMPRA);
  var chavesExistentes = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) {
    var k = _chaveItemData(r.ITEM, r.DATA_LIMITE);
    if (k) chavesExistentes[k] = true;
  });

  var novas = [];
  antigos.forEach(function (r) {
    var chave = _chaveItemData(r.ITEM, r.DATA_LIMITE);
    if (!chave || chavesExistentes[chave]) return; // já está pendente, não duplica
    chavesExistentes[chave] = true;
    novas.push(RELACAO_COMPRA_HEADERS.map(function (h) {
      if (h === 'STATUS') return 'ABERTO';
      return r[h] == null ? '' : r[h];
    }));
  });

  if (novas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, RELACAO_COMPRA_HEADERS.length).setValues(novas);
  }
  var jaPendentes = antigos.length - novas.length;
  Logger.log('%s: %s de %s linha(s) migrada(s) de RELACAO_COMPRA para PENDENCIA_COMPRA (%s já estavam pendentes).',
    unidadeId, novas.length, antigos.length, jaPendentes);
  return { unidade: unidadeId, migrados: novas.length, jaPendentes: jaPendentes };
}
