import math, sys
out = sys.argv[1]
WALL = "#1f2328"; EXT = 12; INT = 7
s = []
def L(x1,y1,x2,y2,w=EXT,c=WALL,cap="square"):
    s.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="{w}" stroke-linecap="{cap}"/>')
def poly(pts,w=EXT):
    s.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="%d" stroke-linejoin="miter"/>'%(" ".join(f"{x},{y}" for x,y in pts),WALL,w))
def window(x1,y1,x2,y2):
    # glazing symbol in an external wall opening
    horiz = y1==y2
    if horiz:
        s.append(f'<rect x="{x1}" y="{y1-6}" width="{x2-x1}" height="12" fill="#fff" stroke="{WALL}" stroke-width="1.5"/>')
        s.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{WALL}" stroke-width="1.5"/>')
    else:
        s.append(f'<rect x="{x1-6}" y="{y1}" width="12" height="{y2-y1}" fill="#fff" stroke="{WALL}" stroke-width="1.5"/>')
        s.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{WALL}" stroke-width="1.5"/>')
def door(hx,hy,ux,uy,nx,ny,w,col=WALL):
    # hinge (hx,hy); u = along the opening; n = side it swings into
    ex,ey = hx+w*ux, hy+w*uy
    ox,oy = hx+w*nx, hy+w*ny
    s.append(f'<line x1="{hx}" y1="{hy}" x2="{ox}" y2="{oy}" stroke="{col}" stroke-width="2.5"/>')
    cross = ux*ny-uy*nx
    sweep = 1 if cross>0 else 0
    s.append(f'<path d="M{ex},{ey} A{w},{w} 0 0 {sweep} {ox},{oy}" fill="none" stroke="{col}" stroke-width="1.2" stroke-dasharray="4 3"/>')
def stairs(x1,y1,x2,y2,n,up_at_top=True):
    s.append(f'<rect x="{x1}" y="{y1}" width="{x2-x1}" height="{y2-y1}" fill="#fff" stroke="{WALL}" stroke-width="1.5"/>')
    for i in range(1,n):
        y=y1+(y2-y1)*i/n
        s.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{WALL}" stroke-width="1"/>')
    cx=(x1+x2)/2
    s.append(f'<line x1="{cx}" y1="{y2-8}" x2="{cx}" y2="{y1+10}" stroke="{WALL}" stroke-width="1.5"/>')
    s.append(f'<path d="M{cx-7},{y1+20} L{cx},{y1+8} L{cx+7},{y1+20}" fill="none" stroke="{WALL}" stroke-width="1.5"/>')
    s.append(f'<text x="{cx}" y="{y2+16}" class="small" text-anchor="middle">UP</text>' if up_at_top else '')
def room(x,y,name,dims=None,imp=None,cls="room"):
    s.append(f'<text x="{x}" y="{y}" class="{cls}" text-anchor="middle">{name}</text>')
    if dims: s.append(f'<text x="{x}" y="{y+24}" class="dim" text-anchor="middle">{dims}</text>')
    if imp: s.append(f'<text x="{x}" y="{y+44}" class="dim" text-anchor="middle">{imp}</text>')
def fill(pts,c="#f6f4ef"):
    s.append('<polygon points="%s" fill="%s"/>'%(" ".join(f"{x},{y}" for x,y in pts),c))
MK=[]
def marker(x,y,n):
    MK.append(f'<circle cx="{x}" cy="{y}" r="12" fill="#d9480f"/><text x="{x}" y="{y+5}" text-anchor="middle" class="mk">{n}</text>')

# ---------- GROUND FLOOR ----------
fill([(283,293),(490,293),(490,580),(283,580)],"#eceae4")             # garage
fill([(553,97),(965,97),(965,580),(875,580),(840,622),(720,622),(690,580),(490,580),(490,297),(553,297)])
# external walls
L(283,293,283,318); L(283,552,283,580)
s.append(f'<rect x="279" y="318" width="8" height="234" fill="#fff" stroke="{WALL}" stroke-width="1.5"/>')  # garage door
L(283,293,365,293); L(425,293,490,293)
door(425,293,-1,0,0,-1,55)                                             # garage rear door
L(283,580,505,580); L(565,580,690,580); L(875,580,965,580)
poly([(690,580),(720,622),(840,622),(875,580)])
s.append(f'<polyline points="696,584 722,616 838,616 869,584" fill="none" stroke="{WALL}" stroke-width="1.5"/>')
door(565,580,-1,0,0,-1,55)                                             # front door
L(965,97,965,580)
L(553,97,590,97); L(650,97,965,97)
door(590,97,1,0,0,-1,55)                                               # back door (was into lean-to)
L(553,97,553,195); L(553,275,553,297); window(553,195,553,275)
# internal
L(490,293,490,535,EXT); L(490,570,490,580,EXT)
door(490,570,0,-1,-1,0,34)                                             # NEW porch -> garage
L(490,297,600,297,INT); L(655,297,770,297,INT); L(770,297,770,350,INT); L(770,350,965,350,INT)
door(600,297,1,0,0,1,52)                                               # kitchen <-> living
L(573,528,573,580,INT); L(565,530,573,530,INT); L(490,530,505,530,INT)   # porch nibs, inner door removed
stairs(497,340,555,465,8)
room(386,440,"Garage")
room(760,190,"Kitchen / Dining","4.93m x 3.15m","16'2\" x 10'4\"")
room(730,450,"Living Room","4.95m x 3.56m","16'3\" x 11'8\"")
s.append('<text x="535" y="562" class="small" text-anchor="middle">Porch</text>')
marker(620,70,1); marker(535,510,2); marker(462,553,3)
s.append('<text x="625" y="690" class="floor" text-anchor="middle">Ground Floor</text>')

# ---------- FIRST FLOOR ----------
fill([(1163,97),(1742,97),(1742,580),(1060,580),(1060,230),(1163,230)])
L(1163,97,1265,97); L(1350,97,1580,97); L(1675,97,1742,97)
window(1265,97,1350,97); window(1580,97,1675,97)
L(1163,97,1163,230); L(1060,230,1163,230)
L(1060,230,1060,580)
L(1060,580,1135,580); L(1220,580,1395,580); L(1480,580,1570,580); L(1655,580,1742,580)
window(1135,580,1220,580); window(1395,580,1480,580); window(1570,580,1655,580)
L(1742,97,1742,580)
# internal
L(1163,232,1290,232,INT); L(1335,232,1460,232,INT)
door(1335,232,-1,0,0,-1,45)                                            # NEW bathroom door off landing
L(1380,97,1380,232,INT)
L(1462,97,1462,140,4); L(1462,200,1462,232,4)                          # cupboard front (partition)
door(1462,200,0,-1,1,0,30)
L(1268,232,1268,240,INT); L(1268,290,1268,580,INT)
door(1268,240,0,1,-1,0,50)                                             # NEW bedroom 3 door off landing
stairs(1275,297,1335,465,8,False)
L(1340,297,1340,470,INT); L(1268,468,1340,468,INT)
L(1340,297,1360,297,INT); L(1415,297,1742,297,INT)
door(1360,297,1,0,0,1,52)                                              # bedroom 1
L(1460,232,1460,240,INT)
door(1460,240,0,1,1,0,52)                                             # bedroom 2 (assumed)
room(1270,150,"Bathroom","2.26m x 2.24m","7'5\" x 7'4\"",cls="roomsm")
s.append('<text x="1421" y="165" class="small" text-anchor="middle">Cpd</text>')
room(1600,165,"Bedroom 2","2.49m x 2.36m","8'2\" x 7'9\"")
room(1165,420,"Bedroom 3","3.12m x 2.54m","10'3\" x 8'4\"")
room(1540,430,"Bedroom 1","4.88m x 3.40m","16'0\" x 11'2\"")
s.append('<text x="1370" y="270" class="small" text-anchor="middle">Landing</text>')
marker(1110,265,4); marker(1312,205,5); marker(1238,265,6); marker(1490,120,7)
s.append('<text x="1400" y="690" class="floor" text-anchor="middle">First Floor</text>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="240 20 1540 740" width="1540" height="740" font-family="Helvetica, Arial, sans-serif">
<style>
.room{{font-size:21px;fill:#1f2328}} .roomsm{{font-size:16px;fill:#1f2328}} .dim{{font-size:15px;fill:#555}}
.small{{font-size:12px;fill:#555;letter-spacing:.5px}} .floor{{font-size:30px;font-weight:700;fill:#1f2328}}
.mk{{font-size:13px;font-weight:700;fill:#fff}} .note{{font-size:13px;fill:#666}}
</style>
<rect x="240" y="20" width="1540" height="740" fill="#ffffff"/>
{"".join(s)}
{"".join(MK)}
<text x="250" y="745" class="note">Current layout, redrawn from the agent's plan with the owner's edits. Not to scale: room sizes are the agent's figures and must be measured on survey. Orange numbers mark changes from the old plan.</text>
</svg>'''
open(out,"w").write(svg)
