/**
 * Config.gs
 * Configuração central do sistema. A planilha funciona apenas como
 * banco de dados; ninguém a acessa diretamente. Todo o acesso é feito
 * por este Web App, que roda com a permissão do dono (executeAs: USER_DEPLOYING).
 */

var CONFIG = {
  APP_NOME: 'Marfim · Gestão de Compras',

  /**
   * ID da planilha usada como banco de dados.
   * Defina em: Configurações do projeto → Propriedades do script → SPREADSHEET_ID.
   * (Mantido fora do código para não expor o ID no repositório.)
   */
  getSpreadsheetId: function () {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) {
      throw new Error('SPREADSHEET_ID não configurado. Defina nas Propriedades do script.');
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
    RELACAO_COMPRA: 'RELACAO_COMPRA'  // resultado da análise de compra
    // Demais tabelas (FIO_CRU, PEDIDOS, TINGIMENTO, EMBARQUES...)
    // serão adicionadas conforme definirmos as regras de negócio.
  },

  /** Duração da sessão (token de login), em horas. */
  SESSAO_HORAS: 12
};
