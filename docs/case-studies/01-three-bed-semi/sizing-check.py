"""Room-by-room heat gain (cooling) and heat loss (heating) check for case study 01.

A simplified fabric calculation: U-values x areas x temperature difference, solar
gain through glazing, ventilation and internal gains. Figures are the assumptions
listed in README.md; replace them with measured values after the survey.
"""
H=2.5
U=dict(wall=1.5, win=2.8, door=3.0, loft=0.5, floor=0.6, party=0.0, garage=1.5)
I={'N':130,'NE':250,'E':600,'S':450,'W':600}   # peak solar on vertical glazing, W/m2
G=0.6                                            # old double glazing g-value x frame
T_OUT_C, T_IN_C, LOFT_C = 30, 24, 40             # cooling design
T_OUT_H = -3                                     # heating design
rooms = {
 'Open-plan kitchen/dining/living': dict(area=15.53+17.62, tin=21, ach=1.5,
   walls=[('N',4.95*H-2.8),('S',4.93*H-1.9),('E',3.15*H-0.9)], garage=3.6*H,
   glaz=[('NE',2.8),('E',0.9)], doors=[('S',1.9)], loft=0, floor=33.15, people=4, other=1000),
 'Bedroom 1': dict(area=4.88*3.40, tin=18, ach=1.0, walls=[('N',4.88*H-2.16)], garage=0,
   glaz=[('N',2.16)], doors=[], loft=4.88*3.40, floor=0, people=2, other=100),
 'Bedroom 2': dict(area=2.49*2.36, tin=18, ach=1.0, walls=[('S',2.49*H-1.2)], garage=0,
   glaz=[('S',1.2)], doors=[], loft=2.49*2.36, floor=0, people=1, other=100),
 'Bedroom 3': dict(area=3.12*2.54, tin=18, ach=1.0, walls=[('N',2.54*H-1.08),('E',3.12*H)], garage=0,
   glaz=[('N',1.08)], doors=[], loft=3.12*2.54, floor=0, people=1, other=100),
}
SOLAIR={'N':2,'NE':3,'E':6,'S':6,'W':8}
for n,r in rooms.items():
    V=r['area']*H
    # heating
    dT=r['tin']-T_OUT_H
    hw=sum(a for _,a in r['walls'])*U['wall']*dT + r['garage']*U['garage']*dT*0.5
    hg=sum(a for _,a in r['glaz'])*U['win']*dT + sum(a for _,a in r['doors'])*U['door']*dT
    hr=r['loft']*U['loft']*dT; hf=r['floor']*U['floor']*dT*0.5
    hv=0.33*r['ach']*V*dT
    heat=hw+hg+hr+hf+hv
    # cooling
    dc=T_OUT_C-T_IN_C
    cw=sum(a*U['wall']*(dc+SOLAIR[o]) for o,a in r['walls'])
    cg=sum(a*U['win']*dc + a*I[o]*G for o,a in r['glaz']) + sum(a*U['door']*dc+a*0.3*I[o]*G for o,a in r['doors'])
    cr=r['loft']*U['loft']*(LOFT_C-T_IN_C)
    cv=0.33*r['ach']*V*dc
    ci=r['people']*75+r['other']
    cool=cw+cg+cr+cv+ci
    print(f"{n:34s} area {r['area']:5.1f}  COOL {cool:5.0f} W ({cool/r['area']:3.0f} W/m2) [walls {cw:.0f} glass {cg:.0f} ceiling {cr:.0f} air {cv:.0f} internal {ci:.0f}]   HEAT {heat:5.0f} W ({heat/r['area']:3.0f} W/m2) [walls {hw:.0f} glass {hg:.0f} ceiling {hr:.0f} floor {hf:.0f} air {hv:.0f}]")
