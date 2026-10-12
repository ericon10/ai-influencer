import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const WORDS = ['Influencer', 'Creator', 'Avatar', 'Celebrity']
const TYPE_SPEED = 75
const DELETE_SPEED = 45
const PAUSE_MS = 1800

function useTypewriter() {
  const [text, setText] = useState('')
  const [wordIdx, setWordIdx] = useState(0)
  const [phase, setPhase] = useState('typing')

  useEffect(() => {
    const word = WORDS[wordIdx]
    if (phase === 'typing') {
      if (text.length < word.length) {
        const t = setTimeout(() => setText(word.slice(0, text.length + 1)), TYPE_SPEED)
        return () => clearTimeout(t)
      } else {
        const t = setTimeout(() => setPhase('deleting'), PAUSE_MS)
        return () => clearTimeout(t)
      }
    }
    if (phase === 'deleting') {
      if (text.length > 0) {
        const t = setTimeout(() => setText(text.slice(0, -1)), DELETE_SPEED)
        return () => clearTimeout(t)
      } else {
        setWordIdx(i => (i + 1) % WORDS.length)
        setPhase('typing')
      }
    }
  }, [text, phase, wordIdx])

  return text
}

export default function Landing() {
  const navigate = useNavigate()
  const animatedWord = useTypewriter()

  return (
    <div style={{
      minHeight: '100vh',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#07070E',
      overflow: 'hidden',
      padding: 'calc(var(--nav-h) + 40px) 24px 80px',
      textAlign: 'center',
    }}>

      {/* Orbs */}
      <div style={{ position:'absolute', width:760, height:760, top:'-22%', left:'-18%', borderRadius:'50%', background:'radial-gradient(circle, rgba(236,72,153,0.28) 0%, transparent 65%)', animation:'orb1 14s ease-in-out infinite', pointerEvents:'none' }}/>
      <div style={{ position:'absolute', width:620, height:620, top:'-14%', right:'-12%', borderRadius:'50%', background:'radial-gradient(circle, rgba(0,113,227,0.22) 0%, transparent 65%)', animation:'orb2 19s ease-in-out infinite', pointerEvents:'none' }}/>
      <div style={{ position:'absolute', width:820, height:820, bottom:'-32%', left:'18%', borderRadius:'50%', background:'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 65%)', animation:'orb3 23s ease-in-out infinite', pointerEvents:'none' }}/>

      {/* Dot grid */}
      <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize:'32px 32px', pointerEvents:'none' }}/>

      {/* Vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(7,7,14,0.82) 100%)',
        pointerEvents: 'none', zIndex: 1,
      }}/>

      {/* ── Center content ── */}
      <div style={{ maxWidth: 680, position: 'relative', zIndex: 2 }}>

        <h1 style={{ fontSize:'clamp(62px,10vw,104px)', fontWeight:800, letterSpacing:'-3.5px', lineHeight:1.0, color:'#fff', marginBottom:2 }}>
          Create Your
        </h1>

        <div style={{
          fontSize: 'clamp(62px,10vw,104px)', fontWeight:800, letterSpacing:'-3.5px', lineHeight:1.1,
          minHeight: '1.15em', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:36,
        }}>
          <span style={{ background:'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #60A5FA 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
            {animatedWord}
          </span>
          <span style={{ display:'inline-block', width:5, height:'0.72em', background:'linear-gradient(to bottom, #EC4899, #A855F7)', marginLeft:6, borderRadius:3, animation:'blink 1s step-end infinite', verticalAlign:'middle', flexShrink:0 }}/>
        </div>

        <p style={{ fontSize:20, color:'rgba(255,255,255,0.38)', lineHeight:1.65, margin:'0 auto 52px', maxWidth:420, fontWeight:400, letterSpacing:'-0.1px' }}>
          Build, manage, and grow your AI influencers.
        </p>

        <button
          onClick={() => navigate('/create')}
          style={{
            padding:'17px 60px', borderRadius:980,
            background:'linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)',
            color:'#fff', fontSize:17, fontWeight:700, letterSpacing:'-0.2px',
            boxShadow:'0 0 32px rgba(168,85,247,0.45), 0 4px 20px rgba(0,0,0,0.5)',
            transition:'transform 0.18s, box-shadow 0.18s',
            border: 'none', cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform='scale(1.04) translateY(-2px)'; e.currentTarget.style.boxShadow='0 0 60px rgba(168,85,247,0.65), 0 8px 32px rgba(0,0,0,0.5)' }}
          onMouseLeave={e => { e.currentTarget.style.transform='scale(1) translateY(0)'; e.currentTarget.style.boxShadow='0 0 32px rgba(168,85,247,0.45), 0 4px 20px rgba(0,0,0,0.5)' }}
        >
          Get Started →
        </button>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes ping {
          0%        { transform: scale(1); opacity: 0.35; }
          80%, 100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes orb1 {
          0%, 100% { transform: translate(0,0) scale(1); }
          33%       { transform: translate(55px,-45px) scale(1.07); }
          66%       { transform: translate(-35px,38px) scale(0.93); }
        }
        @keyframes orb2 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%       { transform: translate(-45px,55px) scale(1.11); }
        }
        @keyframes orb3 {
          0%, 100% { transform: translate(0,0) scale(1); }
          40%       { transform: translate(35px,-55px) scale(0.90); }
          70%       { transform: translate(-55px,22px) scale(1.08); }
        }
        @keyframes cardFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-18px); }
        }
        @keyframes cardSway {
          0%, 100% { transform: translateX(0px); }
          25%       { transform: translateX(5px); }
          75%       { transform: translateX(-4px); }
        }
        @keyframes cardAppear {
          from { opacity: 0; }
          to   { opacity: var(--target-opacity, 0.44); }
        }
        .landing-card { display: block; }
        @media (max-width: 860px) { .landing-card { display: none; } }
      `}</style>
    </div>
  )
}
