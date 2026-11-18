import { Categoria, Produto } from '../../../contratos/modelo';
import * as dados from '../dados.json';
import { Visual } from '../imagens';
import { NichoDemo } from './tipos';

// O primeiro nicho da demo (e o padrão das lojas que já usavam a demonstração): os dados continuam em dados.json,
// com os mesmos ids de produto e de categoria, para não quebrar as regras e a vitrine já gravadas por essas lojas.

const CATALOGO = dados as unknown as { categorias: Categoria[]; produtos: Produto[] };

const VISUAIS: Record<string, Visual> = {
  'PRC-6060-CAL': { forma: 'textura', padrao: 'marmore', cor: '#f4f2ee', cor2: '#8f8f8f' },
  'PRC-12060-CIM': { forma: 'textura', padrao: 'cimento', cor: '#a9a6a0' },
  'PRC-2090-MAD': { forma: 'textura', padrao: 'madeira', cor: '#c9a27a' },
  'PRC-8080-TRA': { forma: 'textura', padrao: 'travertino', cor: '#e3d5bd' },
  'CER-4545-BGE': { forma: 'textura', padrao: 'liso', cor: '#ddd0b8' },
  'CER-6060-EXT': { forma: 'textura', padrao: 'antiderrapante', cor: '#b9b2a6' },
  'REV-1020-SUB': { forma: 'textura', padrao: 'subway', cor: '#fbfbf9', cor2: '#d3d3cf' },
  'REV-3260-3D': { forma: 'textura', padrao: 'ondas', cor: '#efefec' },
  'REV-HEX-SAL': { forma: 'textura', padrao: 'hexagono', cor: '#9caf88', cor2: '#7f9470' },
  'VIN-CLK-CAR': { forma: 'textura', padrao: 'madeira', cor: '#d2b48c' },
  'LAM-7MM-NOG': { forma: 'textura', padrao: 'madeira', cor: '#8a5a3b' },
  'ARG-AC3-20': { forma: 'saco', cor: '#3f6fb5', cor2: '#f2b631', rotulo: 'AC-III', detalhe: 'Argamassa · 20 kg' },
  'ARG-AC2-20': { forma: 'saco', cor: '#5b8f4e', cor2: '#f2b631', rotulo: 'AC-II', detalhe: 'Argamassa · 20 kg' },
  'REJ-EPX-1KG': { forma: 'balde', cor: '#2f4858', cor2: '#f7f7f5', rotulo: 'Epóxi', detalhe: 'Rejunte · 1 kg' },
  'REJ-CIM-5KG': { forma: 'saco', cor: '#7a6a58', cor2: '#ece2cc', rotulo: 'Rejunte', detalhe: 'Flexível · 5 kg' },
  'ACS-NIV-KIT': { forma: 'caixa', cor: '#e2602b', rotulo: 'Nivelador', detalhe: '100 clipes + 50 cunhas' },
  'ACS-ROD-7CM': { forma: 'rodape', cor: '#f5f5f2' },
  'ACS-MAN-10M': { forma: 'rolo', cor: '#4f6d7a', rotulo: 'Manta', detalhe: 'Acústica · 10 m²' },
};

export const revestimentos: NichoDemo = {
  id: 'revestimentos',
  nome: 'Pisos e revestimentos',
  fundoImagem: '#efebe4',
  loja: {
    nome: 'Casa Modelo Revestimentos',
    corPrimaria: '#7a4f2e',
    corTopo: '#2b2622',
    tituloDestaque: 'Seu piso novo, sem sair da conversa',
    boasVindas: 'Calcule as caixas pela metragem, escolha o rejunte e a argamassa e mande o pedido. Um atendente confere tudo com você.',
    vitrineTitulo: 'Mais vendidos',
    vitrineProdutos: ['PRC-6060-CAL', 'PRC-2090-MAD', 'VIN-CLK-CAR', 'REV-HEX-SAL'],
  },
  banners: [
    { titulo: 'Porcelanatos com até 15% off', subtitulo: 'Mármore, madeira e cimento queimado', cor: '#7a4f2e', cor2: '#c49a6c', skus: ['PRC-6060-CAL', 'PRC-2090-MAD', 'PRC-12060-CIM'], categoriaId: '1' },
    { titulo: 'Tudo para assentar', subtitulo: 'Argamassa, rejunte e nivelador', cor: '#2f4858', cor2: '#4f7f93', skus: ['ARG-AC3-20', 'REJ-EPX-1KG', 'ACS-NIV-KIT'], categoriaId: '5' },
  ],
  categorias: CATALOGO.categorias,
  produtos: CATALOGO.produtos.map((p) => ({ ...p, visual: VISUAIS[p.sku] ?? { forma: 'caixa', cor: '#7a4f2e', rotulo: p.nome.split(' ')[0] } })),
};
