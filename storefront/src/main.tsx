import { render } from 'preact';
import { criarApi } from './api';
import { App } from './app';
import { viaCep } from './cep';
import './estilo.css';
import { LinkInvalido } from './telas/LinkInvalido';

// Página /c/:token — o token do link é a única credencial do cliente.
const token = decodeURIComponent((location.pathname.match(/\/c\/([^/?#]+)/) ?? [])[1] ?? '');
const raiz = document.getElementById('app')!;

render(
  token ? <App api={criarApi(token)} buscarCep={(cep) => viaCep(cep)} /> : <LinkInvalido mensagem="Este endereço está incompleto. Use o link enviado no WhatsApp." />,
  raiz,
);
