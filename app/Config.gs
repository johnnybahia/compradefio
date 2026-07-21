/**
 * Config.gs
 * Configuração central do sistema. A planilha funciona apenas como
 * banco de dados; ninguém a acessa diretamente. Todo o acesso é feito
 * por este Web App, que roda com a permissão do dono (executeAs: USER_DEPLOYING).
 */

var CONFIG = {
  APP_NOME: 'Marfim · Gestão de Compras',

  /**
   * Unidades (fábricas/empresas) que este mesmo Web App atende. Cada uma tem
   * sua própria planilha (banco de dados), configurada numa Propriedade do
   * script própria — assim dá pra trocar de unidade num clique, sem precisar
   * de uma implantação separada por empresa.
   */
  UNIDADES: [
    { id: 'CEARA', rotulo: 'Ceará', propSpreadsheet: 'SPREADSHEET_ID_CEARA' },
    { id: 'BAHIA', rotulo: 'Bahia', propSpreadsheet: 'SPREADSHEET_ID_BAHIA' }
  ],

  /** Unidade usada quando o login ainda não escolheu nenhuma. */
  UNIDADE_PADRAO: 'CEARA',

  /** Devolve a configuração de uma unidade pelo id, ou lança erro se inválida. */
  getUnidadeInfo: function (id) {
    var alvo = id || this.UNIDADE_PADRAO;
    var u = this.UNIDADES.filter(function (x) { return x.id === alvo; })[0];
    if (!u) throw new Error('Unidade desconhecida: ' + id);
    return u;
  },

  /**
   * ID da planilha usada como banco de dados da unidade informada (ou da
   * padrão, se `unidadeId` vier vazio).
   * Defina em: Configurações do projeto → Propriedades do script →
   * SPREADSHEET_ID_CEARA / SPREADSHEET_ID_BAHIA.
   * (Mantido fora do código para não expor o ID no repositório.)
   * Compatibilidade: SÓ para a unidade padrão, se a propriedade específica
   * não existir, cai para a antiga `SPREADSHEET_ID` única (instalação de
   * unidade só) — assim uma implantação já em produção continua
   * funcionando sem mudar nada até configurar as propriedades por unidade.
   * As demais unidades NUNCA caem nesse fallback — melhor falhar alto a
   * silenciosamente abrir a planilha errada (ex.: escolher "Bahia" no
   * seletor e cair sem querer nos dados do Ceará).
   */
  getSpreadsheetId: function (unidadeId) {
    var u = this.getUnidadeInfo(unidadeId);
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty(u.propSpreadsheet);
    if (!id && u.id === this.UNIDADE_PADRAO) {
      id = props.getProperty('SPREADSHEET_ID');
    }
    if (!id) {
      throw new Error(
        'Planilha da unidade "' + u.rotulo + '" não configurada. Defina ' +
        u.propSpreadsheet + ' nas Propriedades do script.'
      );
    }
    return id;
  },

  /** Papéis de usuário reconhecidos pelo sistema. */
  PAPEIS: {
    MASTER: 'master',
    TINGIMENTO: 'tingimento',
    ALMOX1: 'almoxarifado1',
    ALMOX2: 'almoxarifado2'
  },

  /** Lista de papéis válidos (para validação). */
  PAPEIS_VALIDOS: ['master', 'tingimento', 'almoxarifado1', 'almoxarifado2'],

  /** Rótulos amigáveis exibidos na interface. */
  PAPEIS_ROTULO: {
    master: 'Master',
    tingimento: 'Tingimento',
    almoxarifado1: 'Almoxarifado 1',
    almoxarifado2: 'Almoxarifado 2'
  },

  /** Nomes das abas (tabelas) no banco de dados. */
  SHEETS: {
    USUARIOS: 'USUARIOS',             // credenciais e papéis
    ESTOQUE: 'ESTOQUE',               // razão de movimentos (fonte da análise)
    ASSOCIACAO: 'ASSOCIAÇÃO',         // tradução código ↔ cadastro (descrição)
    PEDIDO_FIO: 'PEDIDO DE FIO',      // catálogo da produção (código → descrição)
    BASE_TINGIMENTO: 'BASE TINGIMENTO', // capacidades das máquinas por tipo de fio
    EMBARQUES: 'EMBARQUES',           // embarques (preenchido pela leitura do PDF)
    MAPA_EMBARQUE: 'MAPA_EMBARQUE',   // aprendizado: descrição do PDF → item
    PENDENCIAS_EMBARQUE: 'PENDENCIAS EMBARQUE', // itens de embarque parcialmente lançados no estoque
    PENDENCIA_COMPRA: 'PENDENCIA_COMPRA', // backlog vivo: acumula até dar baixa (embarque confirmado ou remoção manual)
    RELACAO_COMPRA: 'RELACAO_COMPRA', // reservada; hoje não é usada (ver PENDENCIA_COMPRA)
    FIO_CRU_ENTRADAS: 'FIO_CRU_ENTRADAS', // lotes de fio crú recebidos (um por NF + tipo de fio)
    FIO_CRU_BAIXAS: 'FIO_CRU_BAIXAS'      // histórico de baixas no fio crú (tingimento consumindo os lotes)
  },

  /** Duração da sessão (token de login), em horas. */
  SESSAO_HORAS: 12
};
