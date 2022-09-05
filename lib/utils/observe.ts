import { Subject, Observable, Subscription } from 'rxjs'
import Debug = require('debug')
const debug = Debug('inquirer-table-select:observe')

export function observeObject<T extends Object>(obj: T): [T, Observable<T>] {
  /// Variables
  const changes$ = new Subject<T>()
  const propertySubscriptions = new Map<PropertyKey, Subscription>()

  /// Helper Functions
  const observeChildObject = <U extends {}>(target: T, prop: PropertyKey, childVal: U): U => {
    const [childProxy, childChanges$] = observeObject(childVal)
    const sub = childChanges$.subscribe((_childObj) => changes$.next(target))
    propertySubscriptions.set(prop, sub)
    return childProxy
  }
  const stopObservingChildObject = (prop: any) => {
    propertySubscriptions.get(prop)!.unsubscribe()
    propertySubscriptions.delete(prop)
  }

  /// Proxy Creation
  const proxy = new Proxy({} as T, {
    set: (target, prop, value, receiver) => {
      debug(`set ${String(prop)}: ${value}`)
      // If property is changed TO an object.
      if (typeof value === 'object' && !propertySubscriptions.has(prop)) {
        value = observeChildObject(target, prop, value)
      }
      // If property is changed FROM an object.
      else if (typeof value !== 'object' && propertySubscriptions.has(prop)) {
        stopObservingChildObject(prop)
      }
      const returnVal = Reflect.set(target, prop, value, receiver)
      changes$.next(target)
      return returnVal
    },
    deleteProperty: (target, prop) => {
      const returnVal = Reflect.deleteProperty(target, prop)
      if (propertySubscriptions.has(prop)) {
        stopObservingChildObject(prop)
      }
      changes$.next(proxy)
      return returnVal
    },
  })

  /// Initialization
  for (let key of Object.keys(obj)) {
    // @ts-ignore
    proxy[key] = obj[key]
  }

  return [proxy, changes$]
}
