// Which candidates are clips (video) rather than stills. A take and its
// upscale come from a scene; an uploaded clip and a clone come from a file
// the owner brought in (UX-PLAN.md: they all show in Library > Clips and in
// every clip picker). A chain is takes joined into one longer clip
// ("Continue this shot", Phase 3).
export const VIDEO_OPS: readonly string[] = ['video', 'video_upscale', 'upload', 'clone', 'chain']

export const isVideoOp = (op: string): boolean => VIDEO_OPS.includes(op)
