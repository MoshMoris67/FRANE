/** Small flat illustrations of the factory's products, used on the performance tiles. */
const G = ({ id }: { id: string }) => <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d4d0c7" /><stop offset="1" stopColor="#8e897e" /></linearGradient></defs>
const svg = { viewBox: '0 0 64 48', className: 'h-12 w-16', 'aria-hidden': true } as const

export const BlockArt = () => (<svg {...svg}><G id="ba" /><path d="M8 18l10-6h38l-10 6z" fill="#e3e0d8" /><path d="M8 18h38v22H8z" fill="url(#ba)" /><path d="M46 18l10-6v22l-10 6z" fill="#77726a" /><rect x="15" y="24" width="9" height="11" rx="1" fill="#4a4741" /><rect x="30" y="24" width="9" height="11" rx="1" fill="#4a4741" /></svg>)
export const PaverArt = () => (<svg {...svg}><G id="pa" /><path d="M6 30l14-7 14 7-14 7z" fill="#b5483a" /><path d="M30 24l14-7 14 7-14 7z" fill="#c25a47" /><path d="M18 18l14-7 14 7-14 7z" fill="#a33f33" /><path d="M6 30v4l14 7v-4z" fill="#7d3027" /><path d="M20 37v4l14-7v-4z" fill="#8f372c" /></svg>)
export const SlabArt = () => (<svg {...svg}><G id="sa" /><path d="M6 20l12-6h36l-12 6z" fill="#e3e0d8" /><path d="M6 20h36v18H6z" fill="url(#sa)" /><path d="M42 20l12-6v18l-12 6z" fill="#77726a" /></svg>)
export const StackArt = () => (<svg {...svg}><G id="ka" /><path d="M10 34h30v8H10z" fill="url(#ka)" /><path d="M14 25h30v8H14z" fill="url(#ka)" opacity=".9" /><path d="M18 16h30v8H18z" fill="url(#ka)" opacity=".8" /><path d="M40 34l8-4v8l-8 4z" fill="#77726a" /><path d="M44 25l8-4v8l-8 4z" fill="#77726a" /></svg>)
