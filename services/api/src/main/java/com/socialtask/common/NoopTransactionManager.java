package com.socialtask.common;

import org.springframework.stereotype.Component;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;

/**
 * 适配 PostgREST 的事务管理器。
 *
 * <p>PostgREST 每次 HTTP 调用即一个独立数据库事务，无法跨请求开启/提交事务。
 * 因此 {@code @Transactional} 与 {@code TransactionTemplate} 在这里只保留语义标记，
 * 不再提供跨语句原子性；需要原子性的关键写入应下沉为数据库函数（见 supabase/bootstrap.sql）。</p>
 */
@Component
public class NoopTransactionManager extends AbstractPlatformTransactionManager {

    @Override
    protected Object doGetTransaction() { return new Object(); }

    @Override
    protected void doBegin(Object transaction, TransactionDefinition definition) { }

    @Override
    protected void doCommit(DefaultTransactionStatus status) { }

    @Override
    protected void doRollback(DefaultTransactionStatus status) { }
}
