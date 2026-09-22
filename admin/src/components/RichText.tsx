export default function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');

  const inline = (value: string) => {
    const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="rich-text">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div className="rich-gap" key={index} />;
        if (trimmed.startsWith('### ')) return <h4 key={index}>{inline(trimmed.slice(4))}</h4>;
        if (trimmed.startsWith('## ')) return <h3 key={index}>{inline(trimmed.slice(3))}</h3>;
        if (trimmed.startsWith('# ')) return <h2 key={index}>{inline(trimmed.slice(2))}</h2>;
        if (/^[-*] /.test(trimmed)) return <div className="rich-bullet" key={index}><span>•</span>{inline(trimmed.slice(2))}</div>;
        if (/^\d+\. /.test(trimmed)) return <div className="rich-number" key={index}><span>{trimmed.match(/^\d+/)?.[0]}.</span>{inline(trimmed.replace(/^\d+\. /, ''))}</div>;
        return <p key={index}>{inline(trimmed)}</p>;
      })}
    </div>
  );
}
