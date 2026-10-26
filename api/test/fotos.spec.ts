import { CredencialInvalida, PlataformaIndisponivel, RecusadoPelaPlataforma } from '../src/conectores/nucleo/erros';
import { destinoFtp, lerCredenciaisFtp, traduzirErroFtp } from '../src/conectores/nucleo/ftp';
import { chavesDoProduto, lerNomeFoto, origemFtp, tipoDaImagem } from '../src/integracoes/fotos.service';

const FTP = { ftp_host: 'arquivos.loja.teste', ftp_porta: '6785', ftp_usuario: 'Kentro', ftp_senha: 's3nha', ftp_pasta: '/Banco de imagens' };

describe('fotos do FTP: nome do arquivo e conteúdo', () => {
  it('lê o padrão combinado: EAN, foto extra (_2) e código interno, sem zeros à esquerda', () => {
    expect(lerNomeFoto('7891234567890.jpg')).toEqual({ chave: '7891234567890', ordem: 1 });
    expect(lerNomeFoto('7891234567890_2.JPG')).toEqual({ chave: '7891234567890', ordem: 2 });
    expect(lerNomeFoto('020800750165.jpeg')).toEqual({ chave: '20800750165', ordem: 1 });
    expect(lerNomeFoto('cod_00123.png')).toEqual({ chave: 'cod_123', ordem: 1 });
    expect(lerNomeFoto('cod_123_3.webp')).toEqual({ chave: 'cod_123', ordem: 3 });
  });

  it('ignora o que não segue o padrão', () => {
    for (const nome of ['foto.jpg', '7891234567890.gif', '12345.jpg', '7891234567890_0.jpg', '7891234567890_11.jpg', 'Thumbs.db', '7891234567890 (1).jpg']) {
      expect(lerNomeFoto(nome)).toBeNull();
    }
  });

  it('o produto procura a foto pelo EAN (com ou sem zero à esquerda) e depois pelo código interno', () => {
    expect(chavesDoProduto('101', '0020800750165')).toEqual(['20800750165', 'cod_101']);
    expect(chavesDoProduto('101', '')).toEqual(['cod_101']);
    expect(chavesDoProduto('101', null)).toEqual(['cod_101']);
  });

  it('o tipo vem do conteúdo, não da extensão', () => {
    expect(tipoDaImagem(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    expect(tipoDaImagem(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
    expect(tipoDaImagem(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('image/webp');
    expect(tipoDaImagem(Buffer.from('<html>não é imagem</html>'))).toBeNull();
  });

  it('a mesma pasta do mesmo servidor é a mesma origem (filiais compartilham as fotos)', () => {
    const a = lerCredenciaisFtp(FTP) as Exclude<ReturnType<typeof lerCredenciaisFtp>, string | null>;
    const b = lerCredenciaisFtp({ ...FTP, ftp_usuario: 'outro', ftp_senha: 'outra' }) as typeof a;
    const c = lerCredenciaisFtp({ ...FTP, ftp_pasta: '/Outra' }) as typeof a;
    expect(origemFtp(a)).toBe(origemFtp(b));
    expect(origemFtp(a)).not.toBe(origemFtp(c));
  });
});

describe('credenciais do FTP de fotos', () => {
  it('sem servidor: a loja não usa fotos por FTP', () => {
    expect(lerCredenciaisFtp({})).toBeNull();
  });

  it('lê e normaliza (ftp:// e barra no fim saem; porta e pasta padrão)', () => {
    expect(lerCredenciaisFtp({ ...FTP, ftp_host: 'ftp://Arquivos.Loja.Teste/' })).toMatchObject({ host: 'arquivos.loja.teste', porta: 6785 });
    expect(lerCredenciaisFtp({ ...FTP, ftp_porta: '', ftp_pasta: '' })).toMatchObject({ porta: 21, pasta: '/' });
  });

  it('recusa rede interna, porta inválida, pasta com .. e falta de usuário ou senha', () => {
    expect(lerCredenciaisFtp({ ...FTP, ftp_host: '10.0.0.5' })).toMatch(/endereço público/);
    expect(lerCredenciaisFtp({ ...FTP, ftp_host: 'arquivos.loja.teste:6785' })).toMatch(/sem ftp:\/\//);
    expect(lerCredenciaisFtp({ ...FTP, ftp_porta: '99999' })).toMatch(/porta/);
    expect(lerCredenciaisFtp({ ...FTP, ftp_pasta: '/fotos/../../etc' })).toMatch(/pasta/);
    expect(lerCredenciaisFtp({ ...FTP, ftp_senha: '' })).toMatch(/usuário e a senha/);
  });

  it('o destino da senha do FTP é o servidor e a porta', () => {
    expect(destinoFtp(FTP)).toBe('arquivos.loja.teste:6785');
    expect(destinoFtp({})).toBe('');
  });

  it('traduz as respostas do FTP sem repassar a mensagem do servidor', () => {
    expect(traduzirErroFtp(Object.assign(new Error('530 User cannot log in.'), { code: 530 }))).toBeInstanceOf(CredencialInvalida);
    expect(traduzirErroFtp(Object.assign(new Error('550 The system cannot find the file'), { code: 550 })).message).toMatch(/pasta das fotos não existe/);
    expect(traduzirErroFtp(new Error("Can't open data connection in passive mode: connect ECONNREFUSED 1.2.3.4:62527"))).toBeInstanceOf(RecusadoPelaPlataforma);
    expect(traduzirErroFtp(new Error('connect ETIMEDOUT'))).toBeInstanceOf(PlataformaIndisponivel);
  });
});
