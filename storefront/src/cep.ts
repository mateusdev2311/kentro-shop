export interface EnderecoCep {
  rua: string;
  bairro: string;
  cidade: string;
  estado: string;
}

/** Endereço pelo CEP (ViaCEP). Falha ou CEP inexistente → null (o cliente preenche à mão). */
export async function viaCep(cep: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<EnderecoCep | null> {
  const digitos = cep.replace(/\D/g, '');
  if (digitos.length !== 8) return null;
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), 5000);
  try {
    const r = await fetchFn(`https://viacep.com.br/ws/${digitos}/json/`, { signal: controle.signal });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || d.erro) return null;
    return { rua: d.logradouro ?? '', bairro: d.bairro ?? '', cidade: d.localidade ?? '', estado: d.uf ?? '' };
  } catch {
    return null;
  } finally {
    clearTimeout(limite);
  }
}
