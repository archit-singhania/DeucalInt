"""Evidence-first analytics. Pure functions shared by the local API and FastAPI."""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from statistics import median, mean
import math

def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()

def dimension(e, key):
    return {'browser':e.get('context',{}).get('browser','Unknown'),'device':e.get('device',{}).get('type','Unknown'),
      'country':e.get('context',{}).get('country','Unknown'),'release':e.get('context',{}).get('release','Unknown'),
      'path':e.get('page',{}).get('path','/'),'name':e['name'],'variant':e.get('properties',{}).get('variant','Unknown')}.get(key)

def validate_ast(ast, depth=0):
    if not isinstance(ast,dict) or depth>4: raise ValueError('Invalid segment')
    if 'and' in ast:
        if set(ast)!={'and'} or not isinstance(ast['and'],list) or len(ast['and'])>10: raise ValueError('Invalid conjunction')
        for a in ast['and']: validate_ast(a,depth+1)
    elif set(ast)!={'dimension','operator','value'} or ast['dimension'] not in ('browser','device','country','release','path','name','variant') or ast['operator'] not in ('eq','neq','in'): raise ValueError('Unsupported segment expression')
    elif ast['operator']=='in':
        if not isinstance(ast['value'],list) or len(ast['value'])>30 or not all(isinstance(v,str) and len(v)<200 for v in ast['value']): raise ValueError('Invalid values')
    elif not isinstance(ast['value'],str) or len(ast['value'])>200: raise ValueError('Invalid value')
    return ast

def matches(e,ast):
    if 'and' in ast: return all(matches(e,a) for a in ast['and'])
    v=dimension(e,ast['dimension']); op=ast['operator']; expected=ast['value']
    return v==expected if op=='eq' else v!=expected if op=='neq' else v in expected

def sessions(events):
    out=defaultdict(list)
    for e in sorted(events,key=lambda x:x['timestamp']): out[e['sessionId']].append(e)
    return out

def pct(a,b): return round(100*a/b,2) if b else 0
def percentile(values,q=.95):
    return round(sorted(values)[min(len(values)-1,math.ceil(len(values)*q)-1)],2) if values else 0

def metrics(events):
    groups=sessions(events); converted={e['sessionId'] for e in events if e['name']=='purchase_completed'}
    durations=[max(0,stamp(v[-1]['timestamp'])-stamp(v[0]['timestamp'])) for v in groups.values()]
    return {'visitors':len({e['anonymousId'] for e in events}),'sessions':len(groups),'pageviews':sum(e['type']=='page' for e in events),
      'events':len(events),'conversions':len(converted),'conversion':pct(len(converted),len(groups)),
      'errors':sum(e['type']=='error' for e in events),'bounce':pct(sum(sum(e['type']=='page' for e in v)<=1 for v in groups.values()),len(groups)),
      'duration':round(mean(durations)) if durations else 0,
      'latency':percentile([float(e['properties']['duration']) for e in events if e['type']=='network' and isinstance(e.get('properties',{}).get('duration'),(int,float))]),
      'revenue':round(sum(e.get('properties',{}).get('amount',0) for e in events if e['name']=='purchase_completed'),2)}

def funnel(events,steps=None,window=1800,ordered=True):
    steps=steps or ['page_view','product_viewed','checkout_started','purchase_completed']
    if not isinstance(steps,list) or not 2<=len(steps)<=8 or not all(isinstance(s,str) for s in steps): raise ValueError('Choose 2–8 steps')
    counts=[0]*len(steps); times=[]
    for es in sessions(events).values():
        best=0; besttime=0
        for start,first in enumerate(es):
            if first['name']!=steps[0]: continue
            eligible=[e for e in es[start:] if stamp(e['timestamp'])-stamp(first['timestamp'])<=window]
            done=1; last=first
            if ordered:
                for e in eligible[1:]:
                    if done<len(steps) and e['name']==steps[done]: done+=1; last=e
            else:
                for s in steps[1:]:
                    found=next((e for e in eligible if e['name']==s),None)
                    if not found: break
                    done+=1; last=max(last,found,key=lambda e:e['timestamp'])
            if done>best: best=done; besttime=stamp(last['timestamp'])-stamp(first['timestamp'])
        for i in range(best): counts[i]+=1
        if best==len(steps): times.append(besttime)
    return {'steps':[{'name':s,'count':counts[i],'rate':pct(counts[i],counts[0]),'dropoff':counts[i-1]-counts[i] if i else 0} for i,s in enumerate(steps)],'medianSeconds':median(times) if times else 0}

def retention(events,now):
    users=defaultdict(set)
    for e in events: users[e['anonymousId']].add(int(stamp(e['timestamp'])//86400))
    cohorts=defaultdict(list)
    for dates in users.values():
        first=min(dates); cohorts[first-first%7].append((first,dates))
    today=int(now//86400); result=[]
    for cohort,people in sorted(cohorts.items())[-6:]:
        cells=[]
        for day in [0,1,3,7,14,30]:
            eligible=[(first,dates) for first,dates in people if first+day<=today]
            cells.append(pct(sum(first+day in dates for first,dates in eligible),len(eligible)) if eligible else None)
        result.append({'cohort':datetime.fromtimestamp(cohort*86400,timezone.utc).strftime('%b %d'),'users':len(people),'values':cells})
    return result

def journeys(events):
    edges=Counter()
    for es in sessions(events).values():
        names=[e.get('page',{}).get('path','/') if e['type']=='page' else e['name'] for e in es if e['type'] in ('page','product','error')]
        for a,b in zip(names,names[1:]):
            if a!=b: edges[(a,b)]+=1
    return [{'from':a,'to':b,'count':n} for (a,b),n in edges.most_common(14)]

def anomalies(series):
    result=[]
    for i in range(7,len(series)):
        history=[x['conversion'] for x in series[max(0,i-14):i]]; center=median(history); mad=median(abs(v-center) for v in history)
        score=.6745*(series[i]['conversion']-center)/max(mad,.5)
        if abs(score)>3.5 and series[i]['sessions']>=20: result.append({**series[i],'baseline':round(center,2),'score':round(score,2),'severity':'critical' if abs(score)>5 else 'warning'})
    return result

def experiments(events):
    exposed=defaultdict(set); converted={e['anonymousId'] for e in events if e['name']=='purchase_completed'}
    for e in events:
        if e['type']=='experiment': exposed[e.get('properties',{}).get('variant','A')].add(e['anonymousId'])
    result=[]
    for variant,users in sorted(exposed.items()):
        n=len(users); c=len(users&converted); p=c/n if n else 0; z=1.96; denom=1+z*z/max(n,1)
        center=(p+z*z/(2*max(n,1)))/denom; half=z*math.sqrt(p*(1-p)/max(n,1)+z*z/(4*max(n,1)**2))/denom
        result.append({'variant':variant,'visitors':n,'conversions':c,'rate':pct(c,n),'interval':[round(100*(center-half),2),round(100*(center+half),2)],'warning':n<100})
    pvalue=None
    if len(result)==2:
        a,b=result; pooled=(a['conversions']+b['conversions'])/(a['visitors']+b['visitors']); se=math.sqrt(pooled*(1-pooled)*(1/a['visitors']+1/b['visitors']))
        pvalue=math.erfc(abs(a['rate']-b['rate'])/100/se/math.sqrt(2)) if se else 1
    return {'variants':result,'pValue':pvalue,'note':'Observational exposure analysis; repeated peeking and mixed exposure can bias results.'}

def investigate(events,start,end):
    midpoint=start+(end-start)/2; before=[e for e in events if stamp(e['timestamp'])<midpoint]; after=[e for e in events if stamp(e['timestamp'])>=midpoint]
    base=metrics(before); current=metrics(after); evidence=[{'id':'metric-1','title':'Conversion comparison','before':base['conversion'],'after':current['conversion'],'unit':'%','samples':[base['sessions'],current['sessions']]}]
    candidates=[]
    for dim in ['browser','device','country','release']:
        for value in sorted({dimension(e,dim) for e in events}):
            b=metrics([e for e in before if dimension(e,dim)==value]); a=metrics([e for e in after if dimension(e,dim)==value])
            if min(a['sessions'],b['sessions'])<10: continue
            impact=(b['conversion']-a['conversion'])/100*a['sessions']
            candidates.append({'dimension':dim,'value':value,'before':b['conversion'],'after':a['conversion'],'impact':round(impact,1),'samples':[b['sessions'],a['sessions']]})
    candidates.sort(key=lambda c:c['impact'],reverse=True)
    for i,c in enumerate(candidates[:5]): evidence.append({'id':f'segment-{i+1}','title':f"{c['dimension']}: {c['value']}",**c,'unit':'%'})
    evidence.extend([{'id':'error-1','title':'JavaScript errors','before':base['errors'],'after':current['errors'],'unit':'events'}, {'id':'network-1','title':'API p95 latency','before':base['latency'],'after':current['latency'],'unit':'ms'}])
    deploys=[{'release':dimension(e,'release'),'timestamp':e['timestamp']} for e in events if e['type']=='deployment']
    direction='decreased' if current['conversion']<base['conversion'] else 'increased'
    return {'summary':f"Checkout conversion {direction} from {base['conversion']}% to {current['conversion']}% across equal time windows.",'contributors':candidates[:5],'evidence':evidence,'deployments':deploys[-5:],
      'caveat':'These are correlated contributors, not proven causes. Overlapping segments must not be added together. Small samples require more data.',
      'mode':'Deterministic evidence engine','window':{'start':start,'midpoint':midpoint,'end':end},'sufficientData':min(base['sessions'],current['sessions'])>=20}
